// SPDX-License-Identifier: Apache-2.0
// Modified in part from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/utils.py (HTML_PARSER)
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/utils.py#L80
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: comments/processing instructions are omitted and templates use ordinary child
// semantics. All preflight, namespace, resource and parse5-adapter code is a fresh
// first-party implementation of the product boundary and HTML parsing semantics.
// parse5 is consumed as a dependency; no parser implementation is copied here.

import {
  type DefaultTreeAdapterTypes,
  parse,
  type Token,
  type TokenHandler,
  Tokenizer,
  TokenizerMode,
} from 'parse5';
import { ExtractionError } from './error.js';
import {
  MAX_ATTRIBUTE_SCAN_COMPARISONS,
  MAX_ATTRIBUTES_PER_TAG,
  MAX_SOURCE_NODES,
  MAX_TREE_DEPTH,
} from './settings.js';
import { type NodeId, Tree } from './tree.js';

function names(source: string): ReadonlySet<string> {
  return new Set(source.split(' '));
}

/** HTML types that do not increase the conservative open-element depth. */
export const NON_STACKING_TAGS = names(
  'area base basefont bgsound body br col colgroup embed frame head hr html iframe img input keygen link meta noembed noframes param plaintext script select source style tbody td textarea tfoot th thead title tr track wbr xmp',
);
/** These starts pop only under their own scoped rules; they are never globally depth-free. */
export const AUTO_CLOSING_TAGS = names('a button dd dt h1 h2 h3 h4 h5 h6 li nobr p');

const HEADINGS = names('h1 h2 h3 h4 h5 h6');
const SCOPE = names('applet caption html marquee object table td template th');
const CLOSE_PARAGRAPH = names(
  'address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form header hgroup hr listing main menu nav ol plaintext pre search section summary table ul xmp',
);
const FORMATTING = names('a b big code em font i nobr s small strike strong tt u');
const TOP_ONLY_END = names(
  'a b big code em font form i nobr optgroup option s small strike strong tt u',
);
const SCOPED_END = names(
  'address article aside blockquote button center dd details dialog dir div dl dt fieldset figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup li listing main menu nav ol p pre search section summary ul',
);
const SPECIAL = names(
  'address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp',
);
const BREAKOUT = names(
  'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var',
);
const MATH_TEXT = names('mi mo mn ms mtext');
const SVG_TEXT = names('foreignobject desc title');
const RAW_TEXT = names('style xmp iframe noembed noframes');

type Namespace = 'html' | 'svg' | 'math';
interface OpenElement {
  name: string;
  namespace: Namespace;
  htmlAnnotation: boolean;
}

/** Fold only ASCII names, retaining non-ASCII custom tag and attribute spellings. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

function integration(element: OpenElement): boolean {
  return (
    (element.namespace === 'svg' && SVG_TEXT.has(element.name)) ||
    (element.namespace === 'math' && MATH_TEXT.has(element.name))
  );
}

/**
 * Conservative stack model. Formatting reconstruction retains open depth; scoped
 * closures cannot remove a boundary that the actual HTML tree builder would retain.
 */
class DepthState {
  /** Context-only scopes restore this position without closing an outer scope again. */
  get checkpoint(): number {
    return this.stack.length;
  }

  restoreCheckpoint(mark: number): void {
    this.stack.length = Math.min(this.stack.length, Math.max(0, mark));
  }

  /** Resolve names used by scope tracking without inventing HTML table tags in foreign content. */
  startsForeign(name: string): boolean {
    return this.foreignStart(name) && !BREAKOUT.has(name);
  }

  /** A matching foreign element owns its end tag before an outer HTML context sees it. */
  foreignMatch(name: string): boolean {
    for (let index = this.stack.length - 1; index >= 0; index -= 1) {
      const frame = this.stack[index];
      if (frame === undefined || frame.namespace === 'html') return false;
      if (frame.name.toLowerCase() === name.toLowerCase()) return true;
    }
    return false;
  }

  private readonly stack: OpenElement[] = [];

  private topHtml(tag: string | ReadonlySet<string>): boolean {
    const top = this.stack.at(-1);
    return (
      top?.namespace === 'html' && (typeof tag === 'string' ? top.name === tag : tag.has(top.name))
    );
  }

  private paragraph(): void {
    if (this.topHtml('p')) this.stack.pop();
  }

  private unwind(index: number): void {
    const retained = this.stack
      .slice(index + 1)
      .filter((element) => element.namespace === 'html' && FORMATTING.has(element.name));
    this.stack.length = index;
    for (const element of retained) this.stack.push(element);
  }

  private breakout(): void {
    while (this.stack.length) {
      const top = this.stack.at(-1);
      if (top === undefined || top.namespace === 'html' || integration(top)) return;
      this.stack.pop();
    }
  }

  private foreignStart(name: string): boolean {
    const top = this.stack.at(-1);
    if (top === undefined || top.namespace === 'html') return false;
    if (top.namespace === 'svg') return !SVG_TEXT.has(top.name);
    if (MATH_TEXT.has(top.name)) return name === 'mglyph' || name === 'malignmark';
    if (top.name === 'annotation-xml') return name !== 'svg' && !top.htmlAnnotation;
    return true;
  }

  get foreignTokenizer(): boolean {
    const top = this.stack.at(-1);
    return (
      top !== undefined &&
      top.namespace !== 'html' &&
      !integration(top) &&
      !(top.namespace === 'math' && top.name === 'annotation-xml' && top.htmlAnnotation)
    );
  }

  private openingHtml(name: string): void {
    if (!AUTO_CLOSING_TAGS.has(name)) {
      if (CLOSE_PARAGRAPH.has(name)) this.paragraph();
      return;
    }
    if (name === 'li' || name === 'dd' || name === 'dt') {
      for (let index = this.stack.length - 1; index >= 0; index -= 1) {
        const frame = this.stack[index];
        if (frame === undefined || frame.namespace !== 'html') break;
        if (name === 'li' ? frame.name === 'li' : frame.name === 'dd' || frame.name === 'dt') {
          this.stack.length = index;
          break;
        }
        if (SPECIAL.has(frame.name) && !['address', 'div', 'p'].includes(frame.name)) break;
      }
      this.paragraph();
    } else if (HEADINGS.has(name)) {
      this.paragraph();
      if (this.topHtml(HEADINGS)) this.stack.pop();
    } else if (name === 'p') {
      this.paragraph();
    } else if (name === 'button') {
      for (let index = this.stack.length - 1; index >= 0; index -= 1) {
        const frame = this.stack[index];
        if (frame === undefined || frame.namespace !== 'html') break;
        if (frame.name === 'button') {
          this.unwind(index);
          break;
        }
        if (SCOPE.has(frame.name)) break;
      }
    } else if (this.topHtml(name)) {
      this.stack.pop();
    }
  }

  start(token: Token.TagToken): Namespace {
    const name = token.tagName;
    let foreign = this.foreignStart(name);
    const font =
      name === 'font' &&
      token.attrs.some((attribute) => ['color', 'face', 'size'].includes(attribute.name));
    if (foreign && (BREAKOUT.has(name) || font)) {
      this.breakout();
      foreign = false;
    }
    const namespace: Namespace = foreign
      ? (this.stack.at(-1)?.namespace ?? 'html')
      : name === 'svg'
        ? 'svg'
        : name === 'math'
          ? 'math'
          : 'html';
    if (namespace === 'html') this.openingHtml(name);
    if (
      (namespace === 'html' && NON_STACKING_TAGS.has(name)) ||
      (namespace !== 'html' && token.selfClosing)
    )
      return namespace;
    const htmlAnnotation =
      name === 'annotation-xml' &&
      token.attrs.some(
        (attribute) =>
          attribute.name === 'encoding' &&
          ['text/html', 'application/xhtml+xml'].includes(asciiLower(attribute.value)),
      );
    this.stack.push({ name, namespace, htmlAnnotation });
    if (this.stack.length > MAX_TREE_DEPTH) throw ExtractionError.tooDeep(MAX_TREE_DEPTH);
    return namespace;
  }

  private closingHtml(name: string): void {
    if (NON_STACKING_TAGS.has(name)) return;
    if (TOP_ONLY_END.has(name)) {
      if (this.topHtml(name)) this.stack.pop();
      return;
    }
    for (let index = this.stack.length - 1; index >= 0; index -= 1) {
      const frame = this.stack[index];
      if (frame === undefined) return;
      if (frame.namespace === 'html' && frame.name === name) {
        this.unwind(index);
        return;
      }
      if (frame.namespace !== 'html') return;
      if (!SCOPED_END.has(name)) {
        if (SPECIAL.has(frame.name)) return;
      } else if (
        SCOPE.has(frame.name) ||
        (name === 'li' && (frame.name === 'ol' || frame.name === 'ul')) ||
        (name === 'p' && frame.name === 'button')
      )
        return;
    }
  }

  end(name: string): void {
    const top = this.stack.at(-1);
    if (top === undefined || top.namespace === 'html') {
      this.closingHtml(name);
      return;
    }
    if (name === 'br' || name === 'p') {
      this.breakout();
      this.closingHtml(name);
      return;
    }
    let crossedForeignScope = false;
    for (let index = this.stack.length - 1; index >= 0; index -= 1) {
      const frame = this.stack[index];
      if (frame === undefined) return;
      // An HTML ancestor outside an integration scope cannot close this foreign subtree.
      if (frame.namespace === 'html' && crossedForeignScope) return;
      if (
        frame.namespace !== 'html' &&
        (integration(frame) || (frame.namespace === 'math' && frame.name === 'annotation-xml'))
      )
        crossedForeignScope = true;
      if (asciiLower(frame.name) === asciiLower(name)) {
        this.stack.length = index;
        return;
      }
      if (index !== this.stack.length - 1 && frame.namespace === 'html') {
        this.closingHtml(name);
        return;
      }
    }
  }
}

/**
 * Intercept attribute creation before parse5 stores or duplicate-scans its name.
 * Both start and end tags use this protected tokenizer API. Raw text, comments,
 * CDATA and script escaping remain the dependency tokenizer's own responsibility.
 */
class BoundedTokenizer extends Tokenizer {
  private attributeToken: unknown;
  private attributes = 0;
  private comparisons = 0;

  protected override _createAttr(first: string): void {
    if (this.attributeToken !== this.currentToken) {
      this.attributeToken = this.currentToken;
      this.attributes = 0;
    }
    this.attributes += 1;
    if (this.attributes > MAX_ATTRIBUTES_PER_TAG) {
      throw ExtractionError.resourceLimit(
        'tag-attributes',
        MAX_ATTRIBUTES_PER_TAG,
        this.attributes,
      );
    }
    this.comparisons += this.attributes - 1;
    if (this.comparisons > MAX_ATTRIBUTE_SCAN_COMPARISONS) {
      throw ExtractionError.resourceLimit(
        'attribute-scan-comparisons',
        MAX_ATTRIBUTE_SCAN_COMPARISONS,
        this.comparisons,
      );
    }
    super._createAttr(first);
  }
}

const SELECT_TABLE_TAGS = names('caption table tbody tfoot thead tr td th');
const TABLE_CONTEXT_TAGS = names('caption col colgroup tbody tfoot thead tr td th');
const TABLE_SECTIONS = names('caption tbody thead tfoot colgroup');
const SELECT_IGNORED_CONTENT = names('html option optgroup hr');
const SELECT_CLOSING_STARTS = names('input keygen textarea');
const TEMPLATE_HEAD_TAGS = names('base basefont bgsound link meta noframes script style title');
const FRAMESET_DISABLED_BY = names(
  'body template pre listing li dd dt button applet marquee object table area br embed img image wbr keygen hr textarea xmp iframe select',
);

interface SelectFrame {
  select: 'ordinary' | 'table' | undefined;
  readonly tables: string[];
  readonly depths: number[];
  pending: boolean;
  readonly templateMark: number;
}

function selectFrame(templateMark: number, pending: boolean): SelectFrame {
  return { select: undefined, tables: [], depths: [], pending, templateMark };
}

/**
 * Track accepted select/table/template contexts separately from counted nesting.
 * Ignored starts cannot select raw-text mode or invent a foreign namespace.
 */
class SelectContext {
  private readonly rootFrame = selectFrame(0, false);
  private readonly frames: SelectFrame[] = [this.rootFrame];
  private framesetAllowed = true;
  private frameset = false;
  private framesetDepth = 0;
  private raw: string | undefined;

  private get frame(): SelectFrame {
    return this.frames.at(-1) ?? this.rootFrame;
  }

  characters(text: string, depth: DepthState): void {
    if (this.raw === undefined && (depth.foreignTokenizer || /[^\t\n\f\r ]/.test(text))) {
      this.framesetAllowed = false;
    }
  }

  /** Return true for a token that must not mutate depth or tokenizer context. */
  beforeStart(name: string, depth: DepthState): boolean {
    if (this.frameset) {
      return (
        name !== 'html' &&
        name !== 'noframes' &&
        !((name === 'frameset' || name === 'frame') && this.framesetDepth > 0)
      );
    }
    if (name === 'frameset' && !this.framesetAllowed && !depth.startsForeign(name)) return true;

    const frame = this.frame;
    if (frame.select === undefined) {
      return (
        !depth.startsForeign(name) &&
        !frame.pending &&
        frame.tables.length === 0 &&
        TABLE_CONTEXT_TAGS.has(name)
      );
    }
    if (name === 'script' || name === 'template') return false;
    if (SELECT_IGNORED_CONTENT.has(name)) return true;
    if (name === 'select') {
      frame.select = undefined;
      return true;
    }
    if (
      SELECT_CLOSING_STARTS.has(name) ||
      (frame.select === 'table' && SELECT_TABLE_TAGS.has(name))
    ) {
      frame.select = undefined;
      return false;
    }
    return true;
  }

  private recordScope(frame: SelectFrame, name: string, checkpoint: number): void {
    frame.depths.length = frame.tables.length;
    frame.depths.push(checkpoint);
    frame.tables.push(name);
  }

  start(name: string, namespace: Namespace, depth: DepthState, token: Token.TagToken): void {
    if (namespace !== 'html') return;
    if (
      RAW_TEXT.has(name) ||
      name === 'title' ||
      name === 'textarea' ||
      name === 'script' ||
      name === 'plaintext'
    ) {
      this.raw = name;
    }
    if (name === 'frameset' && (this.frameset || this.framesetAllowed)) {
      this.frameset = true;
      this.framesetDepth += 1;
      return;
    }
    const visibleInput =
      name === 'input' &&
      !token.attrs.some(
        (attribute) => attribute.name === 'type' && asciiLower(attribute.value) === 'hidden',
      );
    if (FRAMESET_DISABLED_BY.has(name) || visibleInput) this.framesetAllowed = false;

    if (name === 'template') {
      this.frames.push(selectFrame(depth.checkpoint - 1, true));
      return;
    }
    const frame = this.frame;
    const stack = frame.tables;
    const pending = frame.pending;
    if (!TEMPLATE_HEAD_TAGS.has(name)) frame.pending = false;
    if (name === 'select') {
      frame.select = stack.length ? 'table' : 'ordinary';
      return;
    }
    const table = stack.lastIndexOf('table');
    if (name === 'table') {
      if (table >= 0 && !stack.slice(table + 1).some((tag) => tag === 'td' || tag === 'th')) {
        stack.length = table;
      }
      this.recordScope(frame, name, depth.checkpoint - 1);
      return;
    }
    if ((!SELECT_TABLE_TAGS.has(name) && name !== 'colgroup') || (!stack.length && !pending))
      return;
    if (TABLE_SECTIONS.has(name)) {
      stack.length = table + 1;
    } else if (name === 'tr') {
      const row = stack.lastIndexOf('tr');
      if (row > table) stack.length = row;
    } else {
      for (let index = stack.length - 1; index > table; index -= 1) {
        if (stack[index] === 'td' || stack[index] === 'th') {
          stack.length = index;
          break;
        }
      }
      if (table >= 0 && stack.lastIndexOf('tr') <= table) {
        this.recordScope(frame, 'tr', depth.checkpoint);
      }
    }
    this.recordScope(frame, name, depth.checkpoint - (NON_STACKING_TAGS.has(name) ? 0 : 1));
  }

  /**
   * A handled transition has either been ignored or fully restored its scope here.
   * The caller must not close it twice and must always refresh tokenizer namespace state.
   */
  end(name: string, depth: DepthState): 'handled' | 'depth' {
    if (this.raw === name) this.raw = undefined;
    if (this.frameset) {
      if (name === 'frameset' && this.framesetDepth > 0) {
        this.framesetDepth -= 1;
        return 'depth';
      }
      return name === 'noframes' ? 'depth' : 'handled';
    }
    if (name === 'br') this.framesetAllowed = false;
    if (depth.foreignMatch(name)) return 'depth';
    if (name === 'template') {
      if (this.frames.length > 1) {
        const closed = this.frames.pop();
        if (closed !== undefined) depth.restoreCheckpoint(closed.templateMark);
      }
      if (this.frame.select !== undefined) {
        this.frame.select = this.frame.tables.includes('table') ? 'table' : 'ordinary';
      }
      return 'handled';
    }

    const frame = this.frame;
    const stack = frame.tables;
    if (frame.select !== undefined) {
      if (name === 'select') {
        frame.select = undefined;
        return 'handled';
      }
      if (frame.select === 'table' && SELECT_TABLE_TAGS.has(name) && stack.includes(name)) {
        frame.select = undefined;
      } else {
        return 'handled';
      }
    }
    const index = stack.lastIndexOf(name);
    if (index >= 0) {
      depth.restoreCheckpoint(frame.depths[index] ?? depth.checkpoint);
      stack.length = index;
      frame.depths.length = index;
      return 'handled';
    }
    return SELECT_TABLE_TAGS.has(name) || name === 'colgroup' ? 'handled' : 'depth';
  }
}

class Preflight implements TokenHandler {
  readonly depth = new DepthState();
  private readonly selectContext = new SelectContext();
  tokenizer: Tokenizer | undefined;
  private nodes = 0;
  private textRun = false;

  private node(): void {
    this.nodes += 1;
    if (this.nodes > MAX_SOURCE_NODES) {
      throw ExtractionError.resourceLimit('source-nodes', MAX_SOURCE_NODES, this.nodes);
    }
  }
  private structural(): void {
    this.textRun = false;
    this.node();
  }
  onComment(): void {
    this.structural();
  }
  onDoctype(): void {
    this.structural();
  }
  onEof(): void {}

  onStartTag(token: Token.TagToken): void {
    this.structural();
    if (this.selectContext.beforeStart(token.tagName, this.depth)) return;
    const namespace = this.depth.start(token);
    this.selectContext.start(token.tagName, namespace, this.depth, token);
    const tokenizer = this.tokenizer;
    if (tokenizer === undefined) return;
    tokenizer.inForeignNode = this.depth.foreignTokenizer;
    if (namespace !== 'html') return;
    if (token.tagName === 'title' || token.tagName === 'textarea') {
      tokenizer.state = TokenizerMode.RCDATA;
    } else if (RAW_TEXT.has(token.tagName)) {
      tokenizer.state = TokenizerMode.RAWTEXT;
    } else if (token.tagName === 'script') {
      tokenizer.state = TokenizerMode.SCRIPT_DATA;
    } else if (token.tagName === 'plaintext') {
      tokenizer.state = TokenizerMode.PLAINTEXT;
    }
  }
  onEndTag(token: Token.TagToken): void {
    this.textRun = false;
    if (this.selectContext.end(token.tagName, this.depth) === 'depth') {
      this.depth.end(token.tagName);
    }
    // Context restoration owns the pop, but every end path refreshes CDATA/foreign mode.
    if (this.tokenizer) this.tokenizer.inForeignNode = this.depth.foreignTokenizer;
  }
  onCharacter(token: Token.CharacterToken): void {
    this.selectContext.characters(token.chars, this.depth);
    if (token.chars && !this.textRun) {
      this.textRun = true;
      this.node();
    }
  }
  onWhitespaceCharacter(token: Token.CharacterToken): void {
    this.onCharacter(token);
  }
  onNullCharacter(token: Token.CharacterToken): void {
    this.onCharacter(token);
  }
}

/** Complete resource preflight before constructing any DOM. */
export function preflightDocument(html: string): void {
  let nulls = 0;
  for (let index = 0; index < html.length; index += 1) {
    if (html.charCodeAt(index) === 0 && ++nulls > MAX_SOURCE_NODES) {
      throw ExtractionError.resourceLimit('source-nodes', MAX_SOURCE_NODES, nulls);
    }
  }
  const handler = new Preflight();
  const tokenizer = new BoundedTokenizer({}, handler);
  handler.tokenizer = tokenizer;
  tokenizer.write(html, true);
}

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
function isElement(node: Node): node is Element {
  return 'tagName' in node;
}
function children(element: Element): readonly Node[] {
  if (element.tagName === 'template' && 'content' in element && element.childNodes.length === 0) {
    return (element as DefaultTreeAdapterTypes.Template).content.childNodes;
  }
  return element.childNodes;
}

/** Supplied HTML to the product tree, using pinned parser decisions and no network I/O. */
export function parseDocument(html: string): { tree: Tree; root: NodeId } {
  preflightDocument(html);
  const document = parse(html, { scriptingEnabled: false });
  const source = document.childNodes.find(isElement);
  const tree = new Tree();
  const root = tree.create(source ? asciiLower(source.tagName) : 'html');
  if (source === undefined) return { tree, root };

  const attributes = (from: Element, to: NodeId): void => {
    for (const attribute of from.attrs) tree.set(to, asciiLower(attribute.name), attribute.value);
  };
  attributes(source, root);
  const copy = (from: Element, to: NodeId, depth: number): void => {
    if (depth > MAX_TREE_DEPTH) throw ExtractionError.tooDeep(MAX_TREE_DEPTH);
    let previous: NodeId | undefined;
    for (const child of children(from)) {
      if (isElement(child)) {
        const id = tree.createSub(to, asciiLower(child.tagName));
        attributes(child, id);
        copy(child, id, depth + 1);
        previous = id;
      } else if (child.nodeName === '#text' && 'value' in child && child.value) {
        if (previous === undefined) tree.appendText(to, child.value);
        else tree.appendTail(previous, child.value);
      }
    }
  };
  copy(source, root, 1);
  return { tree, root };
}

export function bodyOrRoot(tree: Tree, root: NodeId): NodeId {
  return tree.findDescendant(root, 'body') ?? root;
}
