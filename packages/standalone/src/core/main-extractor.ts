// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/main_extractor.py
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/main_extractor.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh translation organized around one tree/options context. Only the offline
// non-deduplicate product path is implemented. Live prefetched cursors reproduce lxml;
// table-cell budgets, Unicode numeric adapters and incremental scan bounds are first-party.

import { PYTHON_312_DECIMAL_RANGES } from '../metadata/unicode-15.js';
import {
  deleteByLinkDensity,
  handleTextnode,
  joinUrlCompat,
  linkDensityTestTables,
  processNode,
  pruneUnwantedNodes,
} from './htmlprocessing.js';
import type { Options } from './options.js';
import {
  BODY_RULES,
  COMMENTS_DISCARD_RULES,
  COMMENTS_RULES,
  DISCARD_IMAGE_RULES,
  OVERALL_DISCARD_RULES,
  PRECISION_DISCARD_RULES,
  selectFirst,
  TEASER_DISCARD_RULES,
} from './selectors.js';
import {
  DEDUPE_SCAN_CAP,
  INLINE_CARRIED,
  MAX_SPAN,
  MIN_DUPLICATE_LENGTH,
  MIN_EXTRACTED_SIZE,
  TAG_CATALOG,
} from './settings.js';
import { charCount, type NodeId, type Tree } from './tree.js';
import {
  FORMATTING_PROTECTED,
  isImageFile,
  stripPySpace,
  textCharsTest,
  trim,
  trimStartPySpace,
} from './utils.js';

const KEPT_ATTRIBUTES = new Set(['rend', 'role', 'target', 'src', 'alt', 'title']);
const INLINE_WRAPPERS = new Set(['hi', 'ref', 'del']);
const FORMATTING = new Set(['hi', 'ref', 'del', 'span']);
const CELLS = new Set(['td', 'th']);
const QUOTE_TAGS = new Set([...TAG_CATALOG, 'ref', 'graphic']);
interface SelectedText {
  body: NodeId;
  text: string;
  length: number;
}

/** Python _elem_text: concatenate inline character data before trimming. */
export function elemText(tree: Tree, id: NodeId): string {
  return trim(tree.itertext(id));
}

export function documentRoot(tree: Tree, node: NodeId): NodeId {
  let root = node;
  while (tree.parent(root) !== undefined) {
    const parent = tree.parent(root);
    if (parent === undefined) break;
    root = parent;
  }
  return root;
}

/** Python _span's isdecimal/int behavior, using the pinned Unicode decimal ranges. */
export function span(tree: Tree, cell: NodeId, attribute: string): number {
  const text = tree.get(cell, attribute) ?? '1';
  if (!text) return 1;
  let value = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    const range = PYTHON_312_DECIMAL_RANGES.find(([start, end]) => point >= start && point <= end);
    if (range === undefined) return 1;
    value = Math.min(MAX_SPAN, value * 10 + ((point - range[0]) % 10));
  }
  return value;
}

export function isCodeBlockElement(tree: Tree, element: NodeId): boolean {
  if (tree.get(element, 'lang') || tree.tag(element) === 'code') return true;
  const parent = tree.parent(element);
  if (parent !== undefined && tree.getOrEmpty(parent, 'class').includes('highlight')) return true;
  const code = tree.findChild(element, 'code');
  return (
    code !== undefined &&
    tree.childCount(element) === 1 &&
    !stripPySpace(tree.text(element) ?? '') &&
    !stripPySpace(tree.tail(code) ?? '')
  );
}

/** Owns one invocation's algorithm context; all allocated nodes remain in its bounded tree. */
class MainExtractor {
  constructor(
    private readonly tree: Tree,
    private readonly options: Options,
  ) {}

  /** Advance before yielding, as lxml does when the loop body mutates the current subtree. */
  private *live(
    root: NodeId,
    tags: readonly string[] = [],
    includeRoot = false,
  ): Generator<NodeId> {
    let cursor = includeRoot
      ? this.tree.lxmlFirstTreeMatch(root, tags)
      : this.tree.lxmlFirstDescendantMatch(root, tags);
    while (cursor !== undefined) {
      const current = cursor;
      cursor = this.tree.lxmlNextMatch(current, root, tags);
      yield current;
    }
  }

  private rendition(source: NodeId, target: NodeId): void {
    const value = this.tree.get(source, 'rend');
    if (value) this.tree.set(target, 'rend', value);
  }

  /** Python define_newelem; keep only carried inline children and their relevant attributes. */
  private define(source: NodeId | undefined, destination: NodeId, carry = false): void {
    if (source === undefined) return;
    const tree = this.tree;
    const clone = tree.createSub(destination, tree.tag(source));
    tree.setText(clone, tree.text(source));
    tree.setTail(clone, tree.tail(source));
    const node = tree.node(source);
    for (const [index, name] of node.attrNames.entries()) {
      if (KEPT_ATTRIBUTES.has(name)) tree.set(clone, name, node.attrValues[index] ?? '');
    }
    if (!carry) return;
    for (const child of [...tree.children(source)]) {
      if (!INLINE_CARRIED.has(tree.tag(child)) && tree.tag(child) !== 'lb') continue;
      this.define(child, clone, true);
      for (const node of tree.collectTree(child)) tree.markDone(node);
    }
  }

  private title(element: NodeId): NodeId | undefined {
    const tree = this.tree;
    let title: NodeId | undefined;
    if (tree.childCount(element) === 0) title = processNode(tree, element);
    else {
      title = tree.deepCopy(element);
      for (const child of [...tree.children(element)]) {
        const processed = handleTextnode(tree, child, false, false);
        if (processed !== undefined) tree.append(title, processed);
        tree.markDone(child);
      }
    }
    return title !== undefined && textCharsTest(tree.itertext(title)) ? title : undefined;
  }

  private formatting(element: NodeId): NodeId | undefined {
    const tree = this.tree;
    const formatted = processNode(tree, element);
    if (formatted === undefined) return undefined;
    const parent = tree.parent(element) ?? tree.previous(element);
    if (parent !== undefined && FORMATTING_PROTECTED.has(tree.tag(parent))) return formatted;
    const paragraph = tree.create('p');
    tree.insert(paragraph, 0, formatted);
    return paragraph;
  }

  private nested(source: NodeId, target: NodeId): void {
    const tree = this.tree;
    tree.setText(target, tree.text(source));
    for (const child of this.live(source)) {
      if (tree.tag(child) === 'list') {
        const list = this.list(child);
        if (list !== undefined) tree.append(target, list);
      } else if (INLINE_CARRIED.has(tree.tag(child))) {
        this.define(child, target, true);
      } else {
        this.define(handleTextnode(tree, child, false, false), target);
      }
      tree.markDone(child);
    }
  }

  private list(element: NodeId): NodeId | undefined {
    const tree = this.tree;
    const result = tree.create(tree.tag(element));
    const leading = tree.text(element);
    if (leading !== undefined && stripPySpace(leading)) {
      tree.setText(tree.createSub(result, 'item'), leading);
    }
    for (const child of this.live(element, ['item'])) {
      const item = tree.create('item');
      if (tree.childCount(child) === 0) {
        const processed = processNode(tree, child);
        if (processed !== undefined) {
          const tail = tree.tail(processed);
          tree.setText(
            item,
            (tree.text(processed) ?? '') + (tail && stripPySpace(tail) ? ` ${tail}` : ''),
          );
          tree.append(result, item);
        }
      } else {
        this.nested(child, item);
        const tail = tree.tail(child);
        if (tail && stripPySpace(tail)) {
          const last = tree
            .children(item)
            .filter((id) => !tree.isDone(id))
            .at(-1);
          if (last !== undefined) {
            const old = tree.tail(last);
            tree.setTail(last, old && stripPySpace(old) ? `${old} ${tail}` : tail);
          }
        }
      }
      if (tree.text(item) || tree.childCount(item)) {
        this.rendition(child, item);
        tree.append(result, item);
      }
      tree.markDone(child);
    }
    tree.markDone(element);
    if (!textCharsTest(tree.itertext(result))) return undefined;
    this.rendition(element, result);
    return result;
  }

  private code(element: NodeId): NodeId {
    const copy = this.tree.deepCopy(element);
    for (const node of this.tree.collectTree(element)) this.tree.markDone(node);
    this.tree.setTag(copy, 'code');
    return copy;
  }

  private quote(element: NodeId): NodeId | undefined {
    const tree = this.tree;
    if (isCodeBlockElement(tree, element)) return this.code(element);
    const result = tree.create(tree.tag(element));
    tree.setText(result, tree.text(element));
    for (const child of this.live(element)) {
      if (tree.tag(child) === 'graphic') this.define(this.image(child), result);
      else if (tree.tag(child) === 'p' && tree.childCount(child) > 0) {
        const paragraph = this.paragraph(child, QUOTE_TAGS);
        if (paragraph !== undefined) tree.append(result, paragraph);
      } else if (INLINE_CARRIED.has(tree.tag(child))) this.define(child, result, true);
      else this.define(processNode(tree, child), result);
      tree.markDone(child);
    }
    if (!textCharsTest(tree.itertext(result))) return undefined;
    tree.stripTags(result, ['quote']);
    return result;
  }

  private paragraph(element: NodeId, allowed: ReadonlySet<string>): NodeId | undefined {
    const tree = this.tree;
    tree.clearAttrs(element);
    if (!tree.childCount(element)) return processNode(tree, element);
    const result = tree.create(tree.tag(element));
    for (const child of this.live(element, [], true)) {
      if (!allowed.has(tree.tag(child)) && !tree.isDone(child)) continue;
      const processed = handleTextnode(tree, child, false, true);
      if (processed !== undefined) {
        if (tree.tag(processed) === 'p') {
          const current = tree.text(result);
          tree.setText(
            result,
            current ? `${current} ${tree.text(processed) ?? ''}` : (tree.text(processed) ?? ''),
          );
          tree.markDone(child);
          continue;
        }
        const tag = tree.tag(child);
        let created = tree.create(tag);
        if (tree.tag(processed) === 'hi' || tree.tag(processed) === 'ref') {
          const wraps =
            tree.childCount(processed) > 0 &&
            (tree.tag(processed) === 'ref' ||
              tree.children(processed).some((id) => INLINE_CARRIED.has(tree.tag(id))));
          if (wraps) {
            this.define(processed, result, true);
            tree.markDone(child);
            continue;
          }
          let item = tree.children(processed)[0];
          while (item !== undefined) {
            const current = item;
            item = tree.nextSibling(current);
            if (tree.tag(current) === 'lb' && tree.tail(current) !== undefined) {
              tree.setTail(current, ` ${trimStartPySpace(tree.tail(current) ?? '')}`);
            } else if (textCharsTest(tree.text(current))) {
              tree.setText(current, ` ${tree.text(current) ?? ''}`);
            }
            tree.stripTags(processed, [tree.tag(current)]);
          }
          if (tag === 'hi') tree.set(created, 'rend', tree.getOrEmpty(child, 'rend'));
          else if (tag === 'ref') {
            const target = tree.get(child, 'target');
            if (target !== undefined) tree.set(created, 'target', target);
          }
        }
        tree.setText(created, tree.text(processed));
        tree.setTail(created, tree.tail(processed));
        if (tree.tag(processed) === 'graphic') created = this.image(processed) ?? created;
        tree.append(result, created);
      }
      tree.markDone(child);
    }
    const last = tree.children(result).at(-1);
    if (last !== undefined) {
      if (tree.tag(last) === 'lb' && tree.tail(last) === undefined) tree.deleteElement(last, false);
      return result;
    }
    return tree.text(result) ? result : undefined;
  }

  /** All rebuilt cells, including span and caption padding, share the document budget. */
  private cell(header: boolean): NodeId {
    if (!this.tree.chargeTableCell()) {
      const error = this.tree.resourceError();
      if (error !== undefined) throw error;
      throw new Error('Missing table resource failure');
    }
    const cell = this.tree.create('cell');
    if (header) this.tree.set(cell, 'role', 'head');
    return cell;
  }

  private fillCell(
    target: NodeId,
    source: NodeId,
    nested: ReadonlySet<NodeId>,
    allowed: ReadonlySet<string>,
  ): void {
    const tree = this.tree;
    if (!tree.childCount(source)) {
      const processed = processNode(tree, source);
      if (processed !== undefined) {
        tree.setText(target, tree.text(processed));
        tree.setTail(target, tree.tail(processed));
      }
      return;
    }
    tree.setText(target, tree.text(source));
    tree.setTail(target, tree.tail(source));
    tree.markDone(source);
    for (const child of this.live(source)) {
      if (tree.isDone(child)) continue;
      if (nested.has(child)) {
        const tail = tree.tail(child);
        if (tree.tag(child) === 'table' && tail) {
          const last = tree.children(target).at(-1);
          if (last === undefined) tree.appendText(target, tail);
          else tree.appendTail(last, tail);
        }
        continue;
      }
      let processed: NodeId | undefined;
      if (CELLS.has(tree.tag(child))) {
        tree.setTag(child, 'cell');
        processed = handleTextnode(tree, child, true, true);
      } else if (INLINE_WRAPPERS.has(tree.tag(child))) {
        processed = handleTextnode(tree, child, true, true);
        if (processed === undefined && tree.childCount(child) > 0) {
          this.define(child, target, true);
          for (const node of tree.collectTree(child)) tree.markDone(node);
          continue;
        }
      } else if (tree.tag(child) === 'list' && this.options.focus === 'recall') {
        processed = this.list(child);
        if (processed !== undefined) tree.append(target, processed);
        tree.markDone(child);
        continue;
      } else processed = this.handle(child, allowed);
      this.define(processed, target, true);
      tree.markDone(child);
    }
  }

  private table(element: NodeId, allowed: ReadonlySet<string>): NodeId | undefined {
    const tree = this.tree;
    const result = tree.create('table');
    const cellTags = new Set([...allowed, 'div']);
    tree.stripTags(element, ['thead', 'tbody', 'tfoot']);
    const nested = new Set<NodeId>();
    for (const table of tree.collectDescendantsByTag(element, ['table'])) {
      for (const node of tree.collectTree(table)) nested.add(node);
    }
    let width = 0;
    for (const row of tree.findAllChildren(element, 'tr')) {
      let columns = 0;
      for (const cell of tree.children(row)) {
        if (CELLS.has(tree.tag(cell))) columns += span(tree, cell, 'colspan');
      }
      width = Math.max(width, Math.min(columns, MAX_SPAN));
    }
    const pad = (row: NodeId): void => {
      while (tree.childCount(row) < width) tree.append(row, this.cell(false));
    };
    for (const caption of tree.findAllChildren(element, 'caption')) {
      const text = stripPySpace(tree.itertextParts(caption).join(' '));
      if (text) {
        const row = tree.create('row');
        const cell = this.cell(true);
        tree.setText(cell, text);
        tree.append(row, cell);
        pad(row);
        tree.append(result, row);
      }
      tree.markDone(caption);
    }
    const occupied = new Map<number, number>();
    const flush = (row: NodeId): void => {
      for (;;) {
        const column = tree.childCount(row);
        const remaining = occupied.get(column);
        if (remaining === undefined) return;
        tree.append(row, this.cell(false));
        if (remaining <= 1) occupied.delete(column);
        else occupied.set(column, remaining - 1);
      }
    };
    const finish = (row: NodeId): void => {
      flush(row);
      pad(row);
      if (
        tree.children(row).some((cell) => Boolean(tree.text(cell)) || tree.childCount(cell) > 0)
      ) {
        tree.append(result, row);
      }
    };
    let row = tree.create('row');
    let headerEmitted: boolean = false;
    let hasHeader: boolean = false;
    for (const elementChild of [...tree.children(element)]) {
      let cells: readonly NodeId[];
      if (tree.tag(elementChild) === 'tr') {
        if (tree.childCount(row)) {
          finish(row);
          headerEmitted ||= hasHeader;
        }
        row = tree.create('row');
        hasHeader = false;
        flush(row);
        cells = [...tree.children(elementChild)];
      } else if (CELLS.has(tree.tag(elementChild))) cells = [elementChild];
      else {
        if (tree.tag(elementChild) !== 'table') tree.markDone(elementChild);
        continue;
      }
      for (const original of cells) {
        if (!CELLS.has(tree.tag(original))) continue;
        const header: boolean = tree.tag(original) === 'th' && !headerEmitted;
        hasHeader ||= header;
        flush(row);
        const cell = this.cell(header);
        const columns = span(tree, original, 'colspan');
        const rows = span(tree, original, 'rowspan');
        if (rows > 1) {
          const start = tree.childCount(row);
          for (let col = start; col < start + columns; col += 1) occupied.set(col, rows - 1);
        }
        this.fillCell(cell, original, nested, cellTags);
        tree.append(row, cell);
        for (let col = 1; col < columns; col += 1) tree.append(row, this.cell(header));
        tree.markDone(original);
      }
      tree.markDone(elementChild);
    }
    finish(row);
    return tree.childCount(result) ? result : undefined;
  }

  image(element: NodeId | undefined): NodeId | undefined {
    if (element === undefined) return undefined;
    const tree = this.tree;
    const result = tree.create(tree.tag(element));
    let source = ['data-src', 'src'].map((key) => tree.getOrEmpty(element, key)).find(isImageFile);
    if (source === undefined) {
      const node = tree.node(element);
      const index = node.attrNames.findIndex(
        (key, index) => key.startsWith('data-src') && isImageFile(node.attrValues[index]),
      );
      source = index < 0 ? undefined : node.attrValues[index];
    }
    if (source !== undefined) tree.set(result, 'src', source);
    for (const name of ['alt', 'title']) {
      const value = tree.get(element, name);
      if (value) tree.set(result, name, value);
    }
    if (!tree.getOrEmpty(result, 'src')) return undefined;
    const url = tree.getOrEmpty(result, 'src');
    if (!url.startsWith('http')) {
      const resolved =
        this.options.url === undefined
          ? url.startsWith('//')
            ? `http:${url}`
            : url
          : joinUrlCompat(this.options.url, url);
      tree.set(result, 'src', resolved);
    }
    tree.setTail(result, tree.tail(element));
    return result;
  }

  private handle(element: NodeId, allowed: ReadonlySet<string>): NodeId | undefined {
    const tree = this.tree;
    const tag = tree.tag(element);
    if (tag === 'list') return this.list(element);
    if (tag === 'code' || tag === 'quote') return this.quote(element);
    if (tag === 'head') return this.title(element);
    if (tag === 'p') return this.paragraph(element, allowed);
    if (tag === 'lb') {
      if (!textCharsTest(tree.tail(element))) return undefined;
      const processed = processNode(tree, element);
      if (processed === undefined) return undefined;
      const paragraph = tree.create('p');
      tree.setText(paragraph, tree.tail(processed));
      return paragraph;
    }
    if (FORMATTING.has(tag)) return this.formatting(element);
    if (tag === 'table' && allowed.has('table')) return this.table(element, allowed);
    if (tag === 'graphic' && allowed.has('graphic')) return this.image(element);
    if (tag === 'div' && tree.getOrEmpty(element, 'class').includes('w3-code'))
      return this.code(element);
    if (tag === 'div' && allowed.has(tag)) {
      const processed = handleTextnode(tree, element, false, true);
      if (processed !== undefined && textCharsTest(tree.text(processed))) {
        tree.clearAttrs(processed);
        if (tree.tag(processed) === 'div') tree.setTag(processed, 'p');
        return processed;
      }
    }
    return undefined;
  }

  prune(root: NodeId, allowed: ReadonlySet<string>, keepTeasers: boolean): NodeId {
    const tree = this.tree;
    const precise = this.options.focus === 'precision';
    let current = pruneUnwantedNodes(tree, root, OVERALL_DISCARD_RULES, true);
    if (!allowed.has('graphic'))
      current = pruneUnwantedNodes(tree, current, DISCARD_IMAGE_RULES, false);
    if (this.options.focus !== 'recall') {
      if (!keepTeasers) current = pruneUnwantedNodes(tree, current, TEASER_DISCARD_RULES, false);
      if (precise) current = pruneUnwantedNodes(tree, current, PRECISION_DISCARD_RULES, false);
    }
    for (let pass = 0; pass < 2; pass += 1) {
      for (const tag of ['div', 'list', 'p']) {
        current = deleteByLinkDensity(tree, current, tag, tag === 'div', precise);
      }
    }
    if (allowed.has('table') || precise) {
      const tables = tree
        .collectDescendantsByTag(current, ['table'])
        .filter((table) => linkDensityTestTables(tree, table));
      tree.deleteElementsBatch(tables, false);
    }
    if (precise) {
      while (tree.childCount(current)) {
        const last = tree.children(current).at(-1);
        if (last === undefined || tree.tag(last) !== 'head') break;
        tree.deleteElement(last, false);
      }
      current = deleteByLinkDensity(tree, current, 'head', false, true);
      current = deleteByLinkDensity(tree, current, 'quote', false, true);
    }
    return current;
  }

  private recover(source: NodeId, body: NodeId, originalTags: ReadonlySet<string>): NodeId {
    const tree = this.tree;
    const allowed = new Set(originalTags);
    const search = new Set(['code', 'p', 'quote', 'table']);
    if (this.options.focus === 'recall') {
      allowed.add('div');
      allowed.add('lb');
      search.add('div');
      search.add('lb');
      search.add('list');
    }
    const root = this.prune(source, allowed, true);
    tree.stripTags(root, allowed.has('ref') ? ['span'] : ['a', 'ref', 'span']);
    const candidates = tree.collectDescendantsWhere(
      root,
      (id) =>
        search.has(tree.tag(id)) ||
        (tree.tag(id) === 'div' && tree.getOrEmpty(id, 'class').includes('w3-code')),
    );
    const texts = tree.children(body).map((id) => elemText(tree, id));
    const exact = new Set(texts);
    let existing = texts.filter(Boolean).join('\n');
    let length = charCount(existing);
    for (const node of candidates) {
      const processed = this.handle(node, allowed);
      if (processed === undefined) continue;
      const text = elemText(tree, processed);
      const within = length <= DEDUPE_SCAN_CAP;
      if (
        text &&
        (exact.has(text) ||
          (charCount(text) > MIN_DUPLICATE_LENGTH && within && existing.includes(text)))
      )
        continue;
      tree.append(body, processed);
      if (within) {
        existing += `\n${text}`;
        length += 1 + charCount(text);
      }
      exact.add(text);
    }
    return body;
  }

  private body(root: NodeId): { body: NodeId; text: string; allowed: ReadonlySet<string> } {
    const tree = this.tree;
    const allowed = new Set(TAG_CATALOG);
    if (this.options.include_tables)
      for (const tag of ['table', 'td', 'th', 'tr']) allowed.add(tag);
    if (this.options.include_images) allowed.add('graphic');
    if (this.options.include_links) allowed.add('ref');
    const body = tree.create('body');
    for (const rule of BODY_RULES) {
      const candidate = selectFirst(tree, root, rule);
      if (candidate === undefined) continue;
      const selected = this.prune(candidate, allowed, false);
      if (!tree.childCount(selected)) continue;
      let paragraphs = 0;
      for (const node of tree.collectDescendantsByTag(documentRoot(tree, selected), ['p'])) {
        paragraphs += charCount(tree.itertext(node));
      }
      if (paragraphs < MIN_EXTRACTED_SIZE * (this.options.focus === 'precision' ? 1 : 3))
        allowed.add('div');
      if (!allowed.has('ref')) tree.stripTags(selected, ['ref']);
      if (!allowed.has('span')) tree.stripTags(selected, ['span']);
      let candidates = tree.collectDescendants(selected);
      if (candidates.length && candidates.every((id) => tree.tag(id) === 'lb'))
        candidates = [selected];
      const extracted: NodeId[] = [];
      for (const node of candidates) {
        const processed = this.handle(node, allowed);
        if (processed !== undefined) extracted.push(processed);
      }
      tree.extend(body, extracted);
      while (tree.childCount(body)) {
        const last = tree.children(body).at(-1);
        if (last === undefined || !['head', 'ref'].includes(tree.tag(last))) break;
        tree.deleteElement(last, false);
      }
      if (tree.children(body).filter((id) => tree.tag(id) !== 'graphic').length > 1) break;
    }
    return { body, text: stripPySpace(tree.itertextParts(body).join(' ')), allowed };
  }

  content(root: NodeId): SelectedText {
    const tree = this.tree;
    const backup = tree.deepCopy(root);
    const selected = this.body(root);
    let body = selected.body;
    let text = selected.text;
    if (!tree.childCount(body) || charCount(text) < MIN_EXTRACTED_SIZE) {
      body = this.recover(backup, body, selected.allowed);
      text = stripPySpace(tree.itertextParts(body).join(' '));
    }
    let previous: string | undefined;
    const duplicate: NodeId[] = [];
    for (const node of [...tree.children(body)]) {
      const current = elemText(tree, node);
      if (current && current === previous && charCount(current) > MIN_DUPLICATE_LENGTH)
        duplicate.push(node);
      else previous = current;
    }
    tree.deleteElementsBatch(duplicate, false);
    tree.stripElements(body, ['done']);
    tree.stripTags(body, ['div']);
    return { body, text, length: charCount(text) };
  }

  comments(root: NodeId): SelectedText {
    const tree = this.tree;
    const body = tree.create('body');
    for (const rule of COMMENTS_RULES) {
      const candidate = selectFirst(tree, root, rule);
      if (candidate === undefined) continue;
      const selected = pruneUnwantedNodes(tree, candidate, COMMENTS_DISCARD_RULES, false);
      tree.stripTags(selected, ['a', 'ref', 'span']);
      const extracted: NodeId[] = [];
      for (const node of tree.collectDescendants(selected)) {
        if (!TAG_CATALOG.includes(tree.tag(node))) continue;
        const processed = handleTextnode(tree, node, true, false);
        if (processed !== undefined) {
          tree.clearAttrs(processed);
          extracted.push(processed);
        }
      }
      tree.extend(body, extracted);
      if (tree.childCount(body)) {
        tree.deleteElement(selected, false);
        break;
      }
    }
    const text = stripPySpace(tree.itertextParts(body).join(' '));
    return { body, text, length: charCount(text) };
  }
}

export function extractContent(tree: Tree, root: NodeId, options: Options): SelectedText {
  return new MainExtractor(tree, options).content(root);
}
export function extractComments(tree: Tree, root: NodeId, options: Options): SelectedText {
  return new MainExtractor(tree, options).comments(root);
}
export function handleImage(
  tree: Tree,
  element: NodeId | undefined,
  options: Options,
): NodeId | undefined {
  return new MainExtractor(tree, options).image(element);
}
export function pruneUnwantedSections(
  tree: Tree,
  root: NodeId,
  potentialTags: readonly string[],
  options: Options,
  keepTeasers: boolean,
): NodeId {
  return new MainExtractor(tree, options).prune(root, new Set(potentialTags), keepTeasers);
}
