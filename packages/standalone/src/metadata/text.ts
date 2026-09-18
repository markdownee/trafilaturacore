// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/utils.py (HTML_STRIP_TAGS, trim, line_processing, remove_control_characters)
//   trafilatura/json_metadata.py (normalize_json)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: freshly composed metadata helpers reuse the new core character adapters;
// DOM text iteration and ordered deduplication are first-party product support.

import { htmlUnescape, removeControlCharacters as removeControls } from '../core/utils.js';
import { type HElement, type HNode, TEXT_NODE, trim } from './dom.js';

export function stripHtmlTags(text: string): string {
  return text.replace(/<!--.*?-->|<[^>]*>/g, '');
}
export function unescapeHtml(text: string): string {
  return htmlUnescape(text);
}
export function removeControlCharacters(text: string): string {
  return removeControls(text);
}

/** Preserve normalize_json's conditional decoding: entities alone do not trigger that branch. */
export function normalizeJson(input: string): string {
  let text = input;
  if (text.includes('\\')) {
    text = text
      .replace(/\\[nrt]/g, '')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_match, digits: string) => {
        const point = Number.parseInt(digits, 16);
        return point >= 0xd800 && point <= 0xdfff ? '' : String.fromCodePoint(point);
      });
    let scalarText = '';
    for (const character of text) {
      const point = character.codePointAt(0) ?? 0;
      if (point < 0xd800 || point > 0xdfff) scalarText += character;
    }
    text = htmlUnescape(scalarText);
  }
  return trim(stripHtmlTags(text));
}

export function lineProcessing(line: string): string | undefined {
  const expanded = line.replace(/&#13;|&#10;|&nbsp;/g, (entity) =>
    entity === '&#13;' ? '\r' : entity === '&#10;' ? '\n' : '\u00a0',
  );
  return trim(removeControls(expanded)) || undefined;
}

/** lxml itertext's separate text segments, with the metadata layer's space separator. */
export function iterText(element: HElement): string {
  const output: string[] = [];
  const stack: { children: ArrayLike<HNode>; index: number }[] = [
    { children: element.childNodes, index: 0 },
  ];
  while (stack.length) {
    const frame = stack.at(-1);
    if (frame === undefined) break;
    const node = frame.children[frame.index++];
    if (node === undefined) {
      stack.pop();
      continue;
    }
    if (node.nodeType === TEXT_NODE) output.push(node.textContent);
    else {
      const children = node.childNodes;
      if (children.length) stack.push({ children, index: 0 });
    }
  }
  return output.join(' ');
}

export function dedupeOrdered(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}
