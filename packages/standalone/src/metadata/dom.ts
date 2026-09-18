// SPDX-License-Identifier: Apache-2.0
// Modified in part from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/utils.py (trim, via the freshly translated core utility)
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/utils.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: metadata uses the shared translated trim helper. All DOM wrappers, structural
// bookkeeping, selector integration and Python string adapters are fresh first-party code.

import {
  defaultTreeAdapter,
  html as htmlNs,
  type DefaultTreeAdapterTypes as P5,
  parse,
  serialize,
} from 'parse5';
import { charCount } from '../core/tree.js';
import { trim as coreTrim, stripPySpace } from '../core/utils.js';
import { compileSelectorList, type ElementAdapter, matchesSelectorList } from './selector.js';

type RawNode = P5.Node;
type RawParent = P5.ParentNode;
type RawChild = P5.ChildNode;
type RawElement = P5.Element;

export const TEXT_NODE = 3;
interface HAttr {
  readonly name: string;
  readonly value: string;
}
export interface HNode {
  readonly nodeType: number;
  readonly textContent: string;
  readonly parentNode: HElement | null;
  readonly nextSibling: HNode | null;
  readonly previousSibling: HNode | null;
  readonly childNodes: ArrayLike<HNode> & Iterable<HNode>;
  remove(): void;
  replaceWith(...nodes: (HNode | string)[]): void;
}
export interface HElement extends HNode {
  readonly localName: string;
  readonly tagName: string;
  id: string;
  className: string;
  readonly children: ArrayLike<HElement> & Iterable<HElement>;
  readonly firstChild: HNode | null;
  readonly firstElementChild: HElement | null;
  readonly nextElementSibling: HElement | null;
  readonly parentElement: HElement | null;
  readonly innerHTML: string;
  readonly attributes: ArrayLike<HAttr> & Iterable<HAttr>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  closest(selectors: string): HElement | null;
  matches(selectors: string): boolean;
  querySelector(selectors: string): HElement | null;
  querySelectorAll(selectors: string): ArrayLike<HElement> & Iterable<HElement>;
  append(...nodes: (HNode | string)[]): void;
  cloneNode(deep?: boolean): HElement;
}
export interface HDocument {
  readonly documentElement: HElement | null;
  readonly body: HElement | null;
  readonly head: HElement | null;
  querySelector(selectors: string): HElement | null;
  querySelectorAll(selectors: string): ArrayLike<HElement> & Iterable<HElement>;
  createElement(tagName: string): HElement;
  toString(): string;
}

function element(node: RawNode): node is RawElement {
  return 'tagName' in node;
}
function parent(node: RawNode): RawParent | null {
  return 'parentNode' in node ? (node.parentNode ?? null) : null;
}
function html(element: RawElement): boolean {
  return element.namespaceURI === htmlNs.NS.HTML;
}
function lower(value: string): string {
  return value.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}
function attributeName(attribute: { name: string; prefix?: string }): string {
  return attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
}
function attribute(element: RawElement, name: string): string | undefined {
  return element.attrs.find((entry) => attributeName(entry) === name)?.value;
}

/** Defer physical removal until a collection read, preserving linear bulk removal. */
const removals = new Map<RawParent, Set<RawChild>>();
const positions = new WeakMap<RawParent, number>();
function flush(): void {
  for (const [owner, removed] of removals) {
    owner.childNodes = owner.childNodes.filter((node) => !removed.has(node));
    positions.delete(owner);
  }
  removals.clear();
}
function detach(node: RawChild): void {
  const owner = parent(node);
  if (owner === null) return;
  const deleted = removals.get(owner) ?? new Set<RawChild>();
  deleted.add(node);
  removals.set(owner, deleted);
  node.parentNode = null;
}
function indexOf(owner: RawParent, node: RawChild): number {
  const cursor = positions.get(owner) ?? 0;
  const nodes = owner.childNodes;
  const found =
    nodes[cursor] === node
      ? cursor
      : nodes[cursor + 1] === node
        ? cursor + 1
        : nodes[cursor - 1] === node
          ? cursor - 1
          : nodes.indexOf(node);
  if (found >= 0) positions.set(owner, found);
  return found;
}
function textNode(value: string): P5.TextNode {
  return { nodeName: '#text', value, parentNode: null };
}

/** Iterative cursor traversal; early exit never materializes a wide sibling list. */
function* descendants(root: RawParent): Generator<RawNode> {
  const stack: { owner: RawParent; index: number }[] = [{ owner: root, index: 0 }];
  while (stack.length) {
    const frame = stack.at(-1);
    if (frame === undefined) break;
    const node = frame.owner.childNodes[frame.index++];
    if (node === undefined) {
      stack.pop();
      continue;
    }
    yield node;
    if ('childNodes' in node && node.childNodes.length) stack.push({ owner: node, index: 0 });
  }
}
function textContent(node: RawNode): string {
  if (node.nodeName === '#text' && 'value' in node) return node.value;
  if (!('childNodes' in node)) return '';
  const parts: string[] = [];
  for (const child of descendants(node)) {
    if (child.nodeName === '#text' && 'value' in child) parts.push(child.value);
  }
  return parts.join('');
}

const ADAPTER: ElementAdapter<RawElement> = {
  tagName: (node) => node.tagName,
  isHtmlNamespace: html,
  attribute,
  parentElement: (node) => {
    const owner = parent(node);
    return owner !== null && element(owner) ? owner : null;
  },
};
const views = new WeakMap<RawNode, NodeView>();
function view(node: RawNode): NodeView {
  const existing = views.get(node);
  if (existing !== undefined) return existing;
  const wrapped = element(node) ? new ElementView(node) : new NodeView(node);
  views.set(node, wrapped);
  return wrapped;
}
function elementView(node: RawElement): HElement {
  return view(node) as ElementView;
}
function raw(node: HNode | string): RawChild {
  if (typeof node === 'string') return textNode(node);
  if (!(node instanceof NodeView)) throw new TypeError('this DOM accepts only nodes it created');
  return node.raw as RawChild;
}

function select(root: RawParent, selectors: string, first: boolean): HElement[] {
  flush();
  const compiled = compileSelectorList(selectors);
  const result: HElement[] = [];
  for (const node of descendants(root)) {
    if (!element(node) || !matchesSelectorList(compiled, node, ADAPTER)) continue;
    result.push(elementView(node));
    if (first) break;
  }
  return result;
}

class NodeView implements HNode {
  constructor(readonly raw: RawNode) {}
  get nodeType(): number {
    if (this.raw.nodeName === '#text') return TEXT_NODE;
    if (this.raw.nodeName === '#comment') return 8;
    if (this.raw.nodeName === '#documentType') return 10;
    return 1;
  }
  get textContent(): string {
    flush();
    return textContent(this.raw);
  }
  get parentNode(): HElement | null {
    const owner = parent(this.raw);
    return owner !== null && element(owner) ? elementView(owner) : null;
  }
  protected sibling(direction: number, onlyElements = false): HNode | null {
    const owner = parent(this.raw);
    if (owner === null) return null;
    const index = indexOf(owner, this.raw as RawChild);
    if (index < 0) return null;
    for (
      let cursor = index + direction;
      cursor >= 0 && cursor < owner.childNodes.length;
      cursor += direction
    ) {
      const next = owner.childNodes[cursor];
      // A deferred removal is already logically detached. Skipping it avoids rebuilding
      // the parent after every step of a live iterate-and-remove loop.
      if (next === undefined || parent(next) !== owner || (onlyElements && !element(next)))
        continue;
      return view(next);
    }
    return null;
  }
  get nextSibling(): HNode | null {
    return this.sibling(1);
  }
  get previousSibling(): HNode | null {
    return this.sibling(-1);
  }
  get childNodes(): HNode[] {
    flush();
    return 'childNodes' in this.raw ? this.raw.childNodes.map(view) : [];
  }
  remove(): void {
    detach(this.raw as RawChild);
  }

  replaceWith(...nodes: (HNode | string)[]): void {
    flush();
    const owner = parent(this.raw);
    if (owner === null) return;
    const incoming = nodes.map(raw);
    for (const node of incoming) detach(node);
    flush();
    const index = indexOf(owner, this.raw as RawChild);
    if (index < 0) return;
    for (const node of incoming) node.parentNode = owner;
    if (incoming.length === 1 && incoming[0] !== undefined) {
      owner.childNodes[index] = incoming[0];
      positions.set(owner, index);
    } else {
      const next = owner.childNodes.slice(0, index);
      for (const node of incoming) next.push(node);
      for (let cursor = index + 1; cursor < owner.childNodes.length; cursor += 1) {
        const node = owner.childNodes[cursor];
        if (node !== undefined) next.push(node);
      }
      owner.childNodes = next;
      positions.delete(owner);
    }
    if ('parentNode' in this.raw) this.raw.parentNode = null;
  }
}

function shallow(node: RawNode): RawNode {
  if (element(node)) {
    const copy = defaultTreeAdapter.createElement(
      node.tagName,
      node.namespaceURI,
      node.attrs.map((attr) => ({ ...attr })),
    );
    if ('content' in node)
      (copy as P5.Template).content = defaultTreeAdapter.createDocumentFragment();
    return copy;
  }
  const copy = { ...node };
  if ('childNodes' in copy) copy.childNodes = [];
  if ('parentNode' in copy) copy.parentNode = null;
  return copy;
}

function clone(source: RawElement, deep: boolean): RawElement {
  const root = shallow(source) as RawElement;
  if (!deep) return root;
  const pending: [RawNode, RawNode][] = [[source, root]];
  while (pending.length) {
    const pair = pending.pop();
    if (pair === undefined) break;
    const [original, copied] = pair;
    if ('childNodes' in original && 'childNodes' in copied) {
      for (const child of original.childNodes) {
        const next = shallow(child) as RawChild;
        next.parentNode = copied;
        copied.childNodes.push(next);
        pending.push([child, next]);
      }
    }
    if ('content' in original && 'content' in copied) {
      pending.push([(original as P5.Template).content, (copied as P5.Template).content]);
    }
  }
  return root;
}

class ElementView extends NodeView implements HElement {
  constructor(readonly element: RawElement) {
    super(element);
  }
  get localName(): string {
    return this.element.tagName;
  }
  get tagName(): string {
    return html(this.element) ? this.localName.toUpperCase() : this.localName;
  }
  get id(): string {
    return attribute(this.element, 'id') ?? '';
  }
  set id(value: string) {
    this.setAttribute('id', value);
  }
  get className(): string {
    return html(this.element) ? (attribute(this.element, 'class') ?? '') : '';
  }
  set className(value: string) {
    this.setAttribute('class', value);
  }
  get children(): HElement[] {
    flush();
    return this.element.childNodes.filter(element).map(elementView);
  }
  get firstChild(): HNode | null {
    flush();
    const child = this.element.childNodes[0];
    return child === undefined ? null : view(child);
  }
  get firstElementChild(): HElement | null {
    flush();
    const child = this.element.childNodes.find(element);
    return child === undefined ? null : elementView(child);
  }
  get nextElementSibling(): HElement | null {
    return this.sibling(1, true) as HElement | null;
  }
  get parentElement(): HElement | null {
    return this.parentNode;
  }
  get innerHTML(): string {
    flush();
    return serialize(this.element);
  }
  get attributes(): HAttr[] {
    return this.element.attrs.map((entry) => ({ name: attributeName(entry), value: entry.value }));
  }
  private key(name: string): string {
    return html(this.element) ? lower(name) : name;
  }
  getAttribute(name: string): string | null {
    return attribute(this.element, this.key(name)) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }
  setAttribute(name: string, value: string): void {
    const key = this.key(name);
    const existing = this.element.attrs.find((entry) => attributeName(entry) === key);
    if (existing) existing.value = value;
    else this.element.attrs.push({ name: key, value });
  }
  removeAttribute(name: string): void {
    const key = this.key(name);
    const index = this.element.attrs.findIndex((entry) => attributeName(entry) === key);
    if (index >= 0) this.element.attrs.splice(index, 1);
  }
  matches(selectors: string): boolean {
    flush();
    return matchesSelectorList(compileSelectorList(selectors), this.element, ADAPTER);
  }
  closest(selectors: string): HElement | null {
    flush();
    const compiled = compileSelectorList(selectors);
    let current: RawElement | null = this.element;
    while (current !== null) {
      if (matchesSelectorList(compiled, current, ADAPTER)) return elementView(current);
      current = ADAPTER.parentElement(current);
    }
    return null;
  }
  querySelector(selectors: string): HElement | null {
    return select(this.element, selectors, true)[0] ?? null;
  }
  querySelectorAll(selectors: string): HElement[] {
    return select(this.element, selectors, false);
  }
  append(...nodes: (HNode | string)[]): void {
    flush();
    for (const node of nodes) {
      const child = raw(node);
      detach(child);
      flush();
      child.parentNode = this.element;
      this.element.childNodes.push(child);
      positions.delete(this.element);
    }
  }
  cloneNode(deep = false): HElement {
    flush();
    return elementView(clone(this.element, deep));
  }
}

class DocumentView implements HDocument {
  constructor(readonly document: P5.Document) {}
  get documentElement(): HElement | null {
    flush();
    const root = this.document.childNodes.find(element);
    return root === undefined ? null : elementView(root);
  }
  private child(name: string): HElement | null {
    flush();
    const root = this.document.childNodes.find(element);
    const child = root?.childNodes.find(
      (node): node is RawElement => element(node) && node.tagName === name,
    );
    return child === undefined ? null : elementView(child);
  }
  get head(): HElement | null {
    return this.child('head');
  }
  get body(): HElement | null {
    return this.child('body');
  }
  querySelector(selectors: string): HElement | null {
    return select(this.document, selectors, true)[0] ?? null;
  }
  querySelectorAll(selectors: string): HElement[] {
    return select(this.document, selectors, false);
  }
  createElement(tag: string): HElement {
    return elementView(defaultTreeAdapter.createElement(tag, htmlNs.NS.HTML, []));
  }
  toString(): string {
    flush();
    return serialize(this.document);
  }
}

function scope(root: HDocument | HElement): RawParent | undefined {
  if (root instanceof DocumentView) return root.document;
  if (root instanceof ElementView) return root.element;
  return undefined;
}

/** Breadth-first template scopes preserve established image-pass ordering. */
function throughTemplates(
  root: HDocument | HElement,
  selectors: string,
  limit: number,
  visit: (node: HElement) => void,
): number {
  const initial = scope(root);
  if (initial === undefined) return 0;
  flush();
  const compiled = compileSelectorList(selectors);
  const queue: RawParent[] = [initial];
  const seen = new Set<RawParent>();
  let count = 0;
  for (let position = 0; position < queue.length; position += 1) {
    const current = queue[position];
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const node of descendants(current)) {
      if (!element(node)) continue;
      if (node.tagName === 'template' && 'content' in node)
        queue.push((node as P5.Template).content);
      if (matchesSelectorList(compiled, node, ADAPTER)) {
        count += 1;
        visit(elementView(node));
        if (count > limit) return count;
      }
    }
  }
  return count;
}
export function querySelectorAllThroughTemplates(
  root: HDocument | HElement,
  selectors: string,
): HElement[] {
  const found: HElement[] = [];
  throughTemplates(root, selectors, Infinity, (node) => found.push(node));
  return found;
}
export function countThroughTemplates(
  root: HDocument | HElement,
  selectors: string,
  limit: number,
): number {
  return throughTemplates(root, selectors, limit, () => {});
}

/** Metadata keeps scripting enabled so head-level noscript cannot strand later metadata. */
export function parseDocument(html: string): HDocument {
  flush();
  const input = html ?? '';
  const full = /<html[\s>]/i.test(input)
    ? input
    : /<body[\s>]/i.test(input)
      ? `<!doctype html><html>${input}</html>`
      : `<!doctype html><html><body>${input}</body></html>`;
  return new DocumentView(parse(full));
}

export function trim(text: string): string {
  return coreTrim(text);
}
export function pythonStrip(text: string): string {
  return stripPySpace(text);
}
export function pythonLength(text: string): number {
  return charCount(text);
}
export function pythonSlice(text: string, start: number, end?: number): string {
  return Array.from(text).slice(start, end).join('');
}
