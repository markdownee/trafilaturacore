// SPDX-License-Identifier: Apache-2.0
// Parser/matcher for the metadata layer's closed CSS selector grammar.
// Supports descendant chains, lists, type/id selectors and attribute operators/flags.
// Unsupported syntax throws.

export class SelectorSyntaxError extends Error {
  constructor(message: string, selector: string) {
    super(`${message} (in selector ${JSON.stringify(selector)})`);
    this.name = 'SelectorSyntaxError';
  }
}
type Operator = 'exists' | '=' | '^=' | '$=' | '*=' | '~=' | '|=';
interface Condition {
  readonly name: string;
  readonly lowerName: string;
  readonly value: string;
  readonly lowerValue: string;
  readonly operator: Operator;
  readonly flag: 'i' | 's' | undefined;
}
interface Compound {
  readonly tag: string | undefined;
  readonly lowerTag: string | undefined;
  readonly ids: readonly string[];
  readonly attributes: readonly Condition[];
}
export type ComplexSelector = readonly Compound[];
export interface ElementAdapter<T> {
  tagName(element: T): string;
  isHtmlNamespace(element: T): boolean;
  attribute(element: T, qualifiedName: string): string | undefined;
  parentElement(element: T): T | null;
}

const INSENSITIVE = new Set(
  'accept accept-charset align alink axis bgcolor charset checked clear codetype color compact declare defer dir direction disabled enctype face frame hreflang http-equiv lang language link media method multiple nohref noresize noshade nowrap readonly rel rev rules scope scrolling selected shape target text type valign valuetype vlink'.split(
    ' ',
  ),
);
function lower(value: string): string {
  return value.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}
function whitespace(value: string): boolean {
  return value.length === 1 && ' \t\n\r\f'.includes(value);
}
function identifier(value: string): boolean {
  const code = value.charCodeAt(0);
  return /[A-Za-z0-9_-]/.test(value) || code >= 128;
}
function preprocessed(value: string): string {
  let text = '';
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    text += point === 0 || (point >= 0xd800 && point <= 0xdfff) ? '\ufffd' : character;
  }
  return text;
}

class Reader {
  private readonly text: string;
  private offset = 0;
  constructor(private readonly original: string) {
    this.text = preprocessed(original);
  }
  private get current(): string {
    return this.text[this.offset] ?? '';
  }
  private fail(message: string): never {
    throw new SelectorSyntaxError(message, this.original);
  }
  private spaces(): boolean {
    const before = this.offset;
    while (whitespace(this.current)) this.offset += 1;
    return this.offset !== before;
  }
  private escape(): string {
    this.offset += 1;
    if (this.offset === this.text.length) this.fail('trailing backslash');
    const digits = /^[0-9a-fA-F]{1,6}/.exec(this.text.slice(this.offset, this.offset + 6))?.[0];
    if (digits === undefined) return this.text[this.offset++] ?? '';
    this.offset += digits.length;
    if (whitespace(this.current)) this.offset += 1;
    const point = Number.parseInt(digits, 16);
    return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
      ? '\ufffd'
      : String.fromCodePoint(point);
  }
  private word(): string {
    let value = '';
    while (this.offset < this.text.length) {
      if (this.current === '\\') value += this.escape();
      else if (identifier(this.current)) value += this.text[this.offset++];
      else break;
    }
    if (!value) this.fail('expected identifier');
    return value;
  }
  private value(): string {
    const quote = this.current;
    if (quote !== '"' && quote !== "'") return this.word();
    this.offset += 1;
    let value = '';
    while (this.offset < this.text.length) {
      if (this.current === quote) {
        this.offset += 1;
        return value;
      }
      if (this.current === '\\') value += this.escape();
      else {
        if (this.current === '\n') this.fail('newline inside a selector string');
        value += this.text[this.offset++];
      }
    }
    this.fail('unterminated string');
  }
  private attribute(): Condition {
    this.offset += 1;
    this.spaces();
    const name = this.word();
    this.spaces();
    let operator: Operator = 'exists';
    let value = '';
    let flag: 'i' | 's' | undefined;
    if (this.current !== ']') {
      const pair = this.text.slice(this.offset, this.offset + 2);
      switch (pair) {
        case '^=':
        case '$=':
        case '*=':
        case '~=':
        case '|=':
          operator = pair;
          this.offset += 2;
          break;
        default:
          if (this.current !== '=') this.fail('unsupported attribute operator');
          operator = '=';
          this.offset += 1;
      }
      this.spaces();
      value = this.value();
      this.spaces();
      const marker = lower(this.current);
      if (marker === 'i' || marker === 's') {
        flag = marker;
        this.offset += 1;
        this.spaces();
      }
    }
    if (this.current !== ']') this.fail('unterminated attribute selector');
    this.offset += 1;
    return { name, lowerName: lower(name), operator, value, lowerValue: lower(value), flag };
  }
  private compound(): Compound {
    let tag: string | undefined;
    let universal = false;
    if (this.current === '*') {
      universal = true;
      this.offset += 1;
    } else if (this.current && this.current !== '-' && identifier(this.current)) tag = this.word();
    const ids: string[] = [];
    const attributes: Condition[] = [];
    for (;;) {
      if (this.current === '#') {
        this.offset += 1;
        ids.push(this.word());
      } else if (this.current === '[') attributes.push(this.attribute());
      else if (['.', ':', '|'].includes(this.current))
        this.fail('unsupported compound selector syntax');
      else break;
    }
    if (tag === undefined && !universal && !ids.length && !attributes.length)
      this.fail('empty compound selector');
    return { tag, lowerTag: tag === undefined ? undefined : lower(tag), ids, attributes };
  }
  parse(): ComplexSelector[] {
    this.spaces();
    if (!this.current) this.fail('empty selector');
    const result: ComplexSelector[] = [];
    let compounds: Compound[] = [];
    while (this.offset < this.text.length) {
      compounds.push(this.compound());
      const separated = this.spaces();
      if (!this.current) break;
      if (this.current === ',') {
        result.push(compounds);
        compounds = [];
        this.offset += 1;
        this.spaces();
        if (!this.current) this.fail('trailing comma');
      } else if (!separated || ['>', '+', '~'].includes(this.current)) {
        this.fail('unsupported combinator or trailing syntax');
      }
    }
    result.push(compounds);
    return result;
  }
}

const compiled = new Map<string, ComplexSelector[]>();
export function compileSelectorList(source: string): ComplexSelector[] {
  const cached = compiled.get(source);
  if (cached !== undefined) return cached;
  const result = new Reader(source).parse();
  if (compiled.size >= 256) {
    const oldest = compiled.keys().next().value;
    if (oldest !== undefined) compiled.delete(oldest);
  }
  compiled.set(source, result);
  return result;
}

function matchesValue(condition: Condition, original: string, html: boolean): boolean {
  if (condition.operator === 'exists') return true;
  const insensitive =
    condition.flag === 'i' ||
    (condition.flag !== 's' && html && INSENSITIVE.has(condition.lowerName));
  const actual = insensitive ? lower(original) : original;
  const expected = insensitive ? condition.lowerValue : condition.value;
  switch (condition.operator) {
    case '=':
      return actual === expected;
    case '^=':
      return expected !== '' && actual.startsWith(expected);
    case '$=':
      return expected !== '' && actual.endsWith(expected);
    case '*=':
      return expected !== '' && actual.includes(expected);
    case '~=':
      return (
        expected !== '' &&
        !/[ \t\n\r\f]/.test(expected) &&
        actual.split(/[ \t\n\r\f]+/).includes(expected)
      );
    case '|=':
      return actual === expected || actual.startsWith(`${expected}-`);
  }
}
export function matchesCompound<T>(
  compound: Compound,
  node: T,
  adapter: ElementAdapter<T>,
): boolean {
  const html = adapter.isHtmlNamespace(node);
  if (compound.tag !== undefined) {
    const tag = adapter.tagName(node);
    if ((html ? lower(tag) : tag) !== (html ? compound.lowerTag : compound.tag)) return false;
  }
  if (compound.ids.some((id) => adapter.attribute(node, 'id') !== id)) return false;
  for (const condition of compound.attributes) {
    const actual = adapter.attribute(node, html ? condition.lowerName : condition.name);
    if (actual === undefined || !matchesValue(condition, actual, html)) return false;
  }
  return true;
}
export function matchesComplex<T>(
  selector: ComplexSelector,
  node: T,
  adapter: ElementAdapter<T>,
): boolean {
  const subject = selector.at(-1);
  if (subject === undefined || !matchesCompound(subject, node, adapter)) return false;
  let index = selector.length - 2;
  let ancestor = adapter.parentElement(node);
  while (index >= 0 && ancestor !== null) {
    const compound = selector[index];
    if (compound !== undefined && matchesCompound(compound, ancestor, adapter)) index -= 1;
    ancestor = adapter.parentElement(ancestor);
  }
  return index < 0;
}
export function matchesSelectorList<T>(
  selectors: readonly ComplexSelector[],
  node: T,
  adapter: ElementAdapter<T>,
): boolean {
  return selectors.some((selector) => matchesComplex(selector, node, adapter));
}
