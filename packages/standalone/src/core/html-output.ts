// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/htmlprocessing.py (HTML_CONVERSIONS, convert_to_html)
// HTML_CONVERSIONS and convert_to_html (lines 450-482).
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/htmlprocessing.py#L450-L482
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: freshly expressed conversion for product fragments. The iterative writer,
// byte budget, invalid-heading fallback and void-content preservation are first-party.

import { ExtractionError } from './error.js';
import { REND_TAG_MAPPING } from './htmlprocessing.js';
import { MAX_OUTPUT_BYTES } from './settings.js';
import type { NodeId, Tree } from './tree.js';
import { stripPySpace, utf8Length } from './utils.js';

const CONVERSIONS = new Map([
  ['list', 'ul'],
  ['item', 'li'],
  ['code', 'pre'],
  ['quote', 'blockquote'],
  ['lb', 'br'],
  ['graphic', 'img'],
  ['ref', 'a'],
  ['row', 'tr'],
]);
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Convert the selected tree's internal tags, preserving only the output attributes. */
export function convertToHtml(tree: Tree, body: NodeId): void {
  const rend = new Map([...REND_TAG_MAPPING].map(([tag, value]) => [value, tag]));
  for (const node of tree.collectTree(body)) {
    const original = tree.tag(node);
    let tag = CONVERSIONS.get(original);
    if (original === 'head') {
      const level = tree.get(node, 'rend') ?? 'h3';
      tag = /^h[1-6]$/.test(level) ? level : 'h3';
    } else if (original === 'hi') {
      tag = rend.get(tree.get(node, 'rend') ?? '#i') ?? 'i';
    } else if (original === 'cell') {
      tag = tree.get(node, 'role') === 'head' ? 'th' : 'td';
    }
    if (tag === undefined) continue;
    tree.setTag(node, tag);
    if (tag === 'a') {
      const href = tree.get(node, 'target') ?? '';
      tree.clearAttrs(node);
      tree.set(node, 'href', href);
    } else if (tag !== 'img') {
      tree.clearAttrs(node);
    }
  }
  tree.setTag(body, 'body');
}

/** One cumulative byte allowance shared by body and comments. */
export class OutputBudget {
  private emittedBytes = 0;

  constructor(private readonly limit: number = MAX_OUTPUT_BYTES) {}

  static production(): OutputBudget {
    return new OutputBudget();
  }

  charge(bytes: number): void {
    const total = this.emittedBytes + bytes;
    if (total > this.limit) {
      throw ExtractionError.resourceLimit('output-bytes', this.limit, total);
    }
    this.emittedBytes = total;
  }
}

function escaped(text: string, attribute: boolean): string {
  return text.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return attribute ? '&quot;' : character;
    }
  });
}

/**
 * Serialize inner HTML without recursion. Each frame retains only its current child cursor.
 * Converted void tags can retain text/children; emit them after the self-closing tag.
 * The result remains unsanitized and must pass through product cleaning.
 */
export function serializeFragmentBounded(tree: Tree, body: NodeId, budget: OutputBudget): string {
  const output: string[] = [];
  const emit = (value: string): void => {
    budget.charge(utf8Length(value));
    output.push(value);
  };
  const stack: { node: NodeId; entered: boolean; child: number }[] = [
    { node: body, entered: false, child: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const root = stack.length === 1;
    const tag = tree.tag(frame.node);
    if (!frame.entered) {
      frame.entered = true;
      if (!root) {
        emit('<');
        emit(tag);
        const element = tree.node(frame.node);
        for (const [index, name] of element.attrNames.entries()) {
          emit(' ');
          emit(name);
          emit('="');
          emit(escaped(element.attrValues[index] ?? '', true));
          emit('"');
        }
        emit(VOID.has(tag) ? ' />' : '>');
      }
      const text = tree.text(frame.node);
      if (text !== undefined) emit(escaped(text, false));
    }
    const child = tree.children(frame.node)[frame.child];
    if (child !== undefined) {
      frame.child += 1;
      stack.push({ node: child, entered: false, child: 0 });
      continue;
    }
    if (!root) {
      if (!VOID.has(tag)) {
        emit('</');
        emit(tag);
        emit('>');
      }
      const tail = tree.tail(frame.node);
      if (tail !== undefined) emit(escaped(tail, false));
    }
    stack.pop();
  }
  return output.join('');
}

/** Unbounded diagnostic serialization; production always supplies its shared limit. */
export function serializeFragment(tree: Tree, body: NodeId): string {
  return serializeFragmentBounded(tree, body, new OutputBudget(Number.MAX_SAFE_INTEGER));
}

export function resultText(tree: Tree, body: NodeId): string {
  return stripPySpace(tree.itertextParts(body).join(' '));
}
