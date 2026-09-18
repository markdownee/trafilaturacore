// SPDX-License-Identifier: Apache-2.0 AND BSD-3-Clause
// Modified in part from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/xml.py (delete_element)
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/xml.py#L97-L114
// Copyright Adrien Barbaresi and Trafilatura contributors.
// That helper records inherited lxml attribution:
// https://github.com/lxml/lxml/blob/master/src/lxml/html/__init__.py
// lxml.html Copyright (c) 2004 Ian Bicking. BSD-3-Clause; see engine notices.
// Modified: deleteElement translates the pinned Python helper; the stable-id storage,
// budgets, traversal, cloning and structural edits are fresh first-party implementations
// of the product/lxml-semantics contract. No Rust implementation supplies new code here.

import { ExtractionError } from './error.js';
import {
  MAX_ARENA_NODES,
  MAX_ARENA_STRING_BYTES,
  MAX_STRIP_VISITS,
  TABLE_CELL_BUDGET,
} from './settings.js';
import { utf8Length } from './utils.js';

export type NodeId = number;
export const DONE = 'done';

/** The lxml-shaped element record consumed by extraction adapters. */
export interface TreeNode {
  tag: string;
  attrNames: string[];
  attrValues: string[];
  text: string | undefined;
  tail: string | undefined;
  children: NodeId[];
  parent: NodeId | undefined;
}

type Resource = 'arena-nodes' | 'arena-string-bytes' | 'table-cells' | 'strip-visits';

function element(tag: string): TreeNode {
  return {
    tag,
    text: undefined,
    tail: undefined,
    parent: undefined,
    attrNames: [],
    attrValues: [],
    children: [],
  };
}

/** Count scalar values without allocating an array of input characters. */
export function charCount(value: string): number {
  let length = 0;
  for (const _character of value) length += 1;
  return length;
}

/** Stable element identifiers, including detached nodes and independently owned copies. */
export class Tree {
  private readonly storage: TreeNode[] = [];
  private readonly positions = new Map<NodeId, number>();
  private readonly budgets: Record<Resource, { limit: number; used: number }>;
  private failure: ExtractionError | undefined;
  private sentinel: NodeId | undefined;

  constructor(
    arenaNodeLimit = MAX_ARENA_NODES,
    tableCellLimit = TABLE_CELL_BUDGET,
    arenaStringLengthLimit = MAX_ARENA_STRING_BYTES,
    stripVisitLimit = MAX_STRIP_VISITS,
  ) {
    this.budgets = {
      'arena-nodes': { limit: arenaNodeLimit, used: 0 },
      'arena-string-bytes': { limit: arenaStringLengthLimit, used: 0 },
      'table-cells': { limit: tableCellLimit, used: 0 },
      'strip-visits': { limit: stripVisitLimit, used: 0 },
    };
  }

  private consume(resource: Resource, amount: number): boolean {
    if (this.failure !== undefined) return false;
    const budget = this.budgets[resource];
    const observed = budget.used + amount;
    if (observed > budget.limit) {
      this.failure = ExtractionError.resourceLimit(resource, budget.limit, observed);
      return false;
    }
    budget.used = observed;
    return true;
  }

  private emergency(): NodeId {
    if (this.sentinel === undefined) {
      this.sentinel = this.storage.length;
      this.storage.push(element('resource-limit'));
    }
    return this.sentinel;
  }

  resourceError(): ExtractionError | undefined {
    return this.failure;
  }
  chargeTableCell(): boolean {
    return this.consume('table-cells', 1);
  }
  get length(): number {
    return this.storage.length;
  }

  node(id: NodeId): TreeNode {
    const found = this.storage[id];
    if (found === undefined) throw new RangeError('Unknown tree node');
    return found;
  }

  create(tag: string): NodeId {
    if (!this.consume('arena-nodes', 1) || !this.consume('arena-string-bytes', utf8Length(tag))) {
      return this.emergency();
    }
    const id = this.storage.length;
    this.storage.push(element(tag));
    return id;
  }

  createSub(parent: NodeId, tag: string): NodeId {
    const child = this.create(tag);
    this.append(parent, child);
    return child;
  }

  tag(id: NodeId): string {
    return this.node(id).tag;
  }
  setTag(id: NodeId, tag: string): void {
    if (this.consume('arena-string-bytes', utf8Length(tag))) this.node(id).tag = tag;
  }
  markDone(id: NodeId): void {
    this.setTag(id, DONE);
  }
  isDone(id: NodeId): boolean {
    return this.tag(id) === DONE;
  }

  get(id: NodeId, name: string): string | undefined {
    const record = this.node(id);
    return record.attrValues[record.attrNames.indexOf(name)];
  }
  getOrEmpty(id: NodeId, name: string): string {
    return this.get(id, name) ?? '';
  }
  set(id: NodeId, name: string, value: string): void {
    const record = this.node(id);
    const index = record.attrNames.indexOf(name);
    const cost = utf8Length(value) + (index < 0 ? utf8Length(name) : 0);
    if (!this.consume('arena-string-bytes', cost)) return;
    if (index < 0) {
      record.attrNames.push(name);
      record.attrValues.push(value);
    } else record.attrValues[index] = value;
  }
  popAttr(id: NodeId, name: string): string | undefined {
    const record = this.node(id);
    const index = record.attrNames.indexOf(name);
    if (index < 0) return undefined;
    record.attrNames.splice(index, 1);
    return record.attrValues.splice(index, 1)[0];
  }
  clearAttrs(id: NodeId): void {
    this.node(id).attrNames.length = 0;
    this.node(id).attrValues.length = 0;
  }
  hasAttrs(id: NodeId): boolean {
    return this.node(id).attrNames.length > 0;
  }

  text(id: NodeId): string | undefined {
    return this.node(id).text;
  }
  tail(id: NodeId): string | undefined {
    return this.node(id).tail;
  }

  private assignText(id: NodeId, slot: 'text' | 'tail', value: string | undefined): void {
    if (value === undefined || this.consume('arena-string-bytes', utf8Length(value))) {
      this.node(id)[slot] = value;
    }
  }
  setText(id: NodeId, value: string | undefined): void {
    this.assignText(id, 'text', value);
  }
  setTail(id: NodeId, value: string | undefined): void {
    this.assignText(id, 'tail', value);
  }

  private concatenate(id: NodeId, slot: 'text' | 'tail', value: string): void {
    if (this.consume('arena-string-bytes', utf8Length(value))) {
      this.node(id)[slot] = (this.node(id)[slot] ?? '') + value;
    }
  }
  appendText(id: NodeId, value: string): void {
    this.concatenate(id, 'text', value);
  }
  appendTail(id: NodeId, value: string): void {
    this.concatenate(id, 'tail', value);
  }

  children(id: NodeId): readonly NodeId[] {
    return this.node(id).children;
  }
  childCount(id: NodeId): number {
    return this.children(id).length;
  }
  parent(id: NodeId): NodeId | undefined {
    return this.node(id).parent;
  }

  indexInParent(id: NodeId): number | undefined {
    const parent = this.parent(id);
    if (parent === undefined) return undefined;
    const children = this.children(parent);
    const cursor = this.positions.get(parent) ?? 0;
    // Validate a local cursor against live children. Rebuilding a complete index after
    // each detach makes the supported iterate-and-delete traversal quadratic.
    const index =
      children[cursor] === id
        ? cursor
        : children[cursor + 1] === id
          ? cursor + 1
          : children[cursor - 1] === id
            ? cursor - 1
            : children.indexOf(id);
    if (index < 0) return undefined;
    this.positions.set(parent, index);
    return index;
  }
  previous(id: NodeId): NodeId | undefined {
    const index = this.indexInParent(id);
    const parent = this.parent(id);
    return index === undefined || parent === undefined
      ? undefined
      : this.children(parent)[index - 1];
  }
  nextSibling(id: NodeId): NodeId | undefined {
    const index = this.indexInParent(id);
    const parent = this.parent(id);
    return index === undefined || parent === undefined
      ? undefined
      : this.children(parent)[index + 1];
  }

  detach(id: NodeId): void {
    const parent = this.parent(id);
    if (parent === undefined) return;
    const children = this.node(parent).children;
    const index = this.indexInParent(id);
    if (index !== undefined) children.splice(index, 1);
    this.node(id).parent = undefined;
    this.positions.set(parent, index ?? 0);
  }

  append(parent: NodeId, child: NodeId): void {
    if (parent === child) return;
    this.detach(child);
    const children = this.node(parent).children;
    children.push(child);
    this.node(child).parent = parent;
  }
  insert(parent: NodeId, index: number, child: NodeId): void {
    if (parent === child) return;
    this.detach(child);
    const children = this.node(parent).children;
    children.splice(Math.min(index, children.length), 0, child);
    this.node(child).parent = parent;
    this.positions.delete(parent);
  }
  extend(parent: NodeId, ids: readonly NodeId[]): void {
    for (const id of ids) this.append(parent, id);
  }

  /** Direct translation of pinned xml.py::delete_element, retaining its lxml ancestry. */
  deleteElement(id: NodeId, keepTail: boolean): void {
    const parent = this.parent(id);
    if (parent === undefined) return;
    const tail = this.tail(id);
    if (keepTail && tail) {
      const sibling = this.previous(id);
      if (sibling === undefined) this.appendText(parent, tail);
      else this.appendTail(sibling, tail);
    }
    this.detach(id);
  }

  /** Move an existing string slot without charging a new buffer until concatenation occurs. */
  private transfer(parent: NodeId, previous: NodeId | undefined, value: string): void {
    if (!value) return;
    const destination = this.node(previous ?? parent);
    const slot = previous === undefined ? 'text' : 'tail';
    if (destination[slot] === undefined) destination[slot] = value;
    else if (this.consume('arena-string-bytes', utf8Length(value))) destination[slot] += value;
  }

  /** Compact each affected parent once, maintaining tail order across adjacent removals. */
  deleteElementsBatch(ids: readonly NodeId[], keepTail: boolean): void {
    const removed = new Set(ids);
    const parents = new Set<NodeId>();
    for (const id of removed) {
      const parent = this.parent(id);
      if (parent !== undefined) parents.add(parent);
    }
    for (const parent of parents) {
      const kept: NodeId[] = [];
      for (const child of this.children(parent)) {
        if (!removed.has(child)) {
          kept.push(child);
          continue;
        }
        if (keepTail) this.transfer(parent, kept.at(-1), this.tail(child) ?? '');
        this.node(child).parent = undefined;
      }
      this.node(parent).children = kept;
      this.positions.delete(parent);
    }
  }

  moveGroupsAfter(groups: readonly (readonly [NodeId, NodeId[]])[]): void {
    const moves = new Map<NodeId, NodeId[]>();
    const destinations = new Set<NodeId>();
    const detached: NodeId[] = [];
    for (const [anchor, nodes] of groups) {
      const parent = this.parent(anchor);
      if (parent === undefined) continue;
      destinations.add(parent);
      const group = moves.get(anchor) ?? [];
      for (const node of nodes) {
        group.push(node);
        detached.push(node);
      }
      moves.set(anchor, group);
    }
    this.deleteElementsBatch(detached, false);
    for (const parent of destinations) {
      const output: NodeId[] = [];
      for (const child of this.children(parent)) {
        output.push(child);
        for (const moved of moves.get(child) ?? []) {
          output.push(moved);
          this.node(moved).parent = parent;
        }
        moves.delete(child);
      }
      this.node(parent).children = output;
      this.positions.delete(parent);
    }
  }

  private successor(id: NodeId, root: NodeId): NodeId | undefined {
    const first = this.children(id)[0];
    if (first !== undefined) return first;
    let cursor: NodeId | undefined = id;
    while (cursor !== undefined && cursor !== root) {
      const next = this.nextSibling(cursor);
      if (next !== undefined) return next;
      cursor = this.parent(cursor);
    }
    return undefined;
  }

  private matching(
    start: NodeId | undefined,
    root: NodeId,
    tags: readonly string[],
  ): NodeId | undefined {
    let cursor = start;
    while (cursor !== undefined) {
      if (tags.length === 0 || tags.includes(this.tag(cursor))) return cursor;
      cursor = this.successor(cursor, root);
    }
    return undefined;
  }
  lxmlFirstTreeMatch(root: NodeId, tags: readonly string[]): NodeId | undefined {
    return this.matching(root, root, tags);
  }
  lxmlFirstDescendantMatch(root: NodeId, tags: readonly string[]): NodeId | undefined {
    return this.matching(this.children(root)[0], root, tags);
  }
  lxmlNextMatch(current: NodeId, root: NodeId, tags: readonly string[]): NodeId | undefined {
    return this.matching(this.successor(current, root), root, tags);
  }

  *iterTree(root: NodeId): Generator<NodeId> {
    let node: NodeId | undefined = root;
    while (node !== undefined) {
      const yielded: NodeId = node;
      node = this.successor(node, root);
      yield yielded;
    }
  }
  *iterDescendants(root: NodeId): Generator<NodeId> {
    let node = this.children(root)[0];
    while (node !== undefined) {
      const yielded = node;
      node = this.successor(node, root);
      yield yielded;
    }
  }
  collectTree(root: NodeId): NodeId[] {
    return [...this.iterTree(root)];
  }
  collectDescendants(root: NodeId): NodeId[] {
    return [...this.iterDescendants(root)];
  }
  collectTreeWhere(root: NodeId, predicate: (id: NodeId) => boolean): NodeId[] {
    return this.collectTree(root).filter(predicate);
  }
  collectDescendantsWhere(root: NodeId, predicate: (id: NodeId) => boolean): NodeId[] {
    return this.collectDescendants(root).filter(predicate);
  }
  collectDescendantsByTag(root: NodeId, tags: readonly string[]): NodeId[] {
    return this.collectDescendantsWhere(root, (node) => tags.includes(this.tag(node)));
  }
  findDescendantWhere(root: NodeId, predicate: (id: NodeId) => boolean): NodeId | undefined {
    for (const node of this.iterDescendants(root)) if (predicate(node)) return node;
    return undefined;
  }
  anyDescendant(root: NodeId, predicate: (id: NodeId) => boolean): boolean {
    return this.findDescendantWhere(root, predicate) !== undefined;
  }
  findAllChildren(id: NodeId, tag: string): NodeId[] {
    return this.children(id).filter((child) => this.tag(child) === tag);
  }
  findChild(id: NodeId, tag: string): NodeId | undefined {
    return this.children(id).find((child) => this.tag(child) === tag);
  }
  findDescendant(id: NodeId, tag: string): NodeId | undefined {
    return this.findDescendantWhere(id, (child) => this.tag(child) === tag);
  }
  hasAncestor(id: NodeId, tag: string): boolean {
    let node = this.parent(id);
    while (node !== undefined) {
      if (this.tag(node) === tag) return true;
      node = this.parent(node);
    }
    return false;
  }
  private inside(node: NodeId, ancestor: NodeId): boolean {
    for (let parent = this.parent(node); parent !== undefined; parent = this.parent(parent)) {
      if (parent === ancestor) return true;
    }
    return false;
  }

  /** Emulate lxml's prefetched match and detached-subtree stop, using bulk deletion. */
  deleteAllWithTagLxml(root: NodeId, tag: string): void {
    const matches = this.collectTreeWhere(root, (node) => this.tag(node) === tag);
    let boundary: NodeId | undefined;
    const removed: NodeId[] = [];
    for (let index = 0; index < matches.length; index += 1) {
      const node = matches[index];
      if (node === undefined) continue;
      if (boundary !== undefined && !this.inside(node, boundary)) break;
      removed.push(node);
      const next = matches[index + 1];
      if (boundary === undefined && next !== undefined && this.inside(next, node)) boundary = node;
    }
    this.deleteElementsBatch(removed, true);
  }

  itertext(root: NodeId): string {
    return this.itertextParts(root).join('');
  }
  itertextParts(root: NodeId): string[] {
    const result: string[] = [];
    const stack: { node: NodeId; child: number; entered: boolean }[] = [
      { node: root, child: 0, entered: false },
    ];
    while (stack.length) {
      const frame = stack.at(-1);
      if (frame === undefined) break;
      if (!frame.entered) {
        frame.entered = true;
        const text = this.text(frame.node);
        if (text !== undefined) result.push(text);
      }
      const child = this.children(frame.node)[frame.child];
      if (child !== undefined) {
        frame.child += 1;
        stack.push({ node: child, child: 0, entered: false });
      } else {
        if (stack.length > 1) {
          const tail = this.tail(frame.node);
          if (tail !== undefined) result.push(tail);
        }
        stack.pop();
      }
    }
    return result;
  }

  stripTags(root: NodeId, tags: readonly string[]): void {
    if (!tags.length) return;
    const selected = new Set(tags);
    const strip = (parent: NodeId): void => {
      const children = this.children(parent);
      if (!this.consume('strip-visits', children.length)) return;
      let found = false;
      for (const child of children) {
        if (this.childCount(child)) strip(child);
        if (selected.has(this.tag(child))) found = true;
      }
      if (!found) return;
      const rebuilt: NodeId[] = [];
      for (const child of children) {
        const node = this.node(child);
        if (!selected.has(node.tag)) {
          rebuilt.push(child);
          continue;
        }
        this.transfer(parent, rebuilt.at(-1), node.text ?? '');
        node.text = undefined;
        for (const grandchild of node.children) {
          this.node(grandchild).parent = parent;
          rebuilt.push(grandchild);
        }
        node.children = [];
        this.positions.delete(child);
        this.transfer(parent, rebuilt.at(-1), node.tail ?? '');
        node.tail = undefined;
        node.parent = undefined;
      }
      this.node(parent).children = rebuilt;
      this.positions.delete(parent);
    };
    strip(root);
  }

  stripElements(root: NodeId, tags: readonly string[]): void {
    if (!tags.length) return;
    const selected = new Set(tags);
    const pending = [root];
    while (pending.length) {
      const parent = pending.pop();
      if (parent === undefined) break;
      const kept: NodeId[] = [];
      for (const child of this.children(parent)) {
        if (selected.has(this.tag(child))) this.node(child).parent = undefined;
        else {
          kept.push(child);
          pending.push(child);
        }
      }
      this.node(parent).children = kept;
      this.positions.delete(parent);
    }
  }

  unwrapElement(id: NodeId): void {
    const parent = this.parent(id);
    const index = this.indexInParent(id);
    if (parent === undefined || index === undefined) return;
    const children = this.node(parent).children;
    const current = this.node(id);
    const preceding = children[index - 1];
    if (current.text) {
      if (preceding === undefined) this.appendText(parent, current.text);
      else this.appendTail(preceding, current.text);
    }
    const rebuilt = children.slice(0, index);
    for (const child of current.children) {
      this.node(child).parent = parent;
      rebuilt.push(child);
    }
    const last = rebuilt.at(-1);
    if (current.tail) {
      if (last === undefined) this.appendText(parent, current.tail);
      else this.appendTail(last, current.tail);
    }
    for (let after = index + 1; after < children.length; after += 1) {
      const child = children[after];
      if (child !== undefined) rebuilt.push(child);
    }
    current.text = undefined;
    current.tail = undefined;
    current.children = [];
    current.parent = undefined;
    this.node(parent).children = rebuilt;
    this.positions.delete(parent);
    this.positions.delete(id);
  }

  /** Charge the full node payload before cloning it, and never return a partial clone. */
  deepCopy(id: NodeId): NodeId {
    const copy = (sourceId: NodeId): NodeId => {
      const source = this.node(sourceId);
      let bytes = utf8Length(source.tag);
      for (let index = 0; index < source.attrNames.length; index += 1) {
        bytes +=
          utf8Length(source.attrNames[index] ?? '') + utf8Length(source.attrValues[index] ?? '');
      }
      bytes += utf8Length(source.text ?? '') + utf8Length(source.tail ?? '');
      if (!this.consume('arena-nodes', 1) || !this.consume('arena-string-bytes', bytes)) {
        return this.emergency();
      }
      const destination = this.storage.length;
      const copied: TreeNode = {
        ...source,
        parent: undefined,
        children: [],
        attrNames: source.attrNames.slice(),
        attrValues: source.attrValues.slice(),
      };
      this.storage.push(copied);
      for (const child of source.children) {
        const clone = copy(child);
        if (this.failure !== undefined) return this.emergency();
        copied.children.push(clone);
        this.node(clone).parent = destination;
      }
      return destination;
    };
    const result = copy(id);
    this.node(result).parent = undefined;
    return result;
  }
}
