// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/utils.py
// trim, text_chars_test, textfilter, remove_control_characters, is_image_file,
// is_image_element, RE_FILTER, FORMATTING_PROTECTED and LINK_FARM_RATIO.
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/utils.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh offline TypeScript translation. Unicode tables carry their own
// provenance. Whitespace, entity-decoding and byte-count adapters are first-party;
// image recognition and leading-word scans avoid the upstream regex's quadratic work.

import { decodeHTML } from 'entities/decode';
import { isPythonWord, PYTHON_312_REJECTED_RANGES } from '../metadata/unicode-15.js';
import type { NodeId, Tree } from './tree.js';

/** CPython 3.12 whitespace, including the four information separators and excluding FEFF. */
export const PY_SPACE_CLASS =
  '\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const SPACE_POINTS = new Set([
  9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198,
  8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288,
]);
const SPACE_RUN = new RegExp(`[${PY_SPACE_CLASS}]+`, 'g');

export function isPySpaceCode(code: number): boolean {
  return SPACE_POINTS.has(code);
}

export function isPySpace(character: string): boolean {
  return character.length === 1 && SPACE_POINTS.has(character.charCodeAt(0));
}

/** Universal whitespace test; the empty input is handled by textCharsTest separately. */
export function isAllPySpace(value: string): boolean {
  return stripPySpace(value).length === 0;
}

export function trimStartPySpace(input: string): string {
  let start = 0;
  for (; start < input.length && isPySpaceCode(input.charCodeAt(start)); start += 1) {}
  return input.slice(start);
}

export function stripPySpace(input: string): string {
  let end = input.length;
  let start = 0;
  for (; start < end && isPySpaceCode(input.charCodeAt(start)); start += 1) {}
  for (; end > start && isPySpaceCode(input.charCodeAt(end - 1)); end -= 1) {}
  return input.slice(start, end);
}

/** Python utils.py::trim, without allocating a list of every word. */
export function trim(input: string): string {
  return stripPySpace(input).replace(SPACE_RUN, ' ');
}

export function trimOrNone(input: string | undefined): string | undefined {
  return trim(input ?? '') || undefined;
}

export function textCharsTest(value: string | undefined): boolean {
  return value !== undefined && value.length > 0 && !isAllPySpace(value);
}

/** Python splitlines keeps interior empty lines and omits the final delimiter's empty field. */
export function pySplitlines(value: string): string[] {
  if (!value) return [];
  // biome-ignore lint/suspicious/noControlCharactersInRegex: these are the CPython splitlines delimiters.
  const lines = value.split(/\r\n|[\n\v\f\r\u001c-\u001e\u0085\u2028\u2029]/u);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Product resource accounting uses UTF-8 bytes, including replacement for lone surrogates. */
export function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

const SHARE_LINE =
  /^(?:Drucken|E-?Mail|Facebook|Flipboard|Google|Instagram|Linkedin|Mail|PDF|Pinterest|Pocket|Print|QQ|Reddit|Twitter|WeChat|WeiBo|Whatsapp|Xing|Mehr zum Thema:?|More on this.{0,8})$/iu;

/** Python utils.py::textfilter; word boundaries use the pinned data rather than host Unicode. */
export function textfilter(tree: Tree, id: NodeId): boolean {
  const own = tree.text(id);
  const text = own === undefined ? tree.tail(id) : own;
  if (!textCharsTest(text)) return true;
  for (const line of pySplitlines(text ?? '')) {
    let offset = 0;
    for (const character of line) {
      if (isPythonWord(character.codePointAt(0) ?? 0)) break;
      offset += character.length;
    }
    if (SHARE_LINE.test(line.slice(offset))) return true;
  }
  return false;
}

const rejected = PYTHON_312_REJECTED_RANGES.map(([start, end]) => {
  const first = `\\u{${start.toString(16)}}`;
  return start === end ? first : `${first}-\\u{${end.toString(16)}}`;
}).join('');
const REJECTED_CHARACTERS = new RegExp(`[${rejected}]`, 'gu');

/** Python utils.py::remove_control_characters, evaluated against the pinned UCD table. */
export function removeControlCharacters(input: string): string {
  return input.replace(REJECTED_CHARACTERS, '');
}

/**
 * HTML character references with Python's observable invalid-numeric handling.
 * Named references and the HTML Windows-1252 remapping come from the installed entities
 * decoder. This adapter retains Python's omission of disallowed control/noncharacters.
 */
export function htmlUnescape(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&#(?:[xX][0-9a-fA-F]+|[0-9]+);?|&[^\t\n\f <&#;]{1,32};?/gu, (reference) => {
    if (reference[1] !== '#') return decodeHTML(reference);
    const hex = reference[2] === 'x' || reference[2] === 'X';
    const point = Number.parseInt(reference.slice(hex ? 3 : 2), hex ? 16 : 10);
    if (!Number.isFinite(point) || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))
      return '\ufffd';
    if (
      (point >= 1 && point <= 8) ||
      point === 11 ||
      (point >= 14 && point <= 31) ||
      point === 127 ||
      (point >= 0xfdd0 && point <= 0xfdef) ||
      (point & 0xffff) >= 0xfffe
    )
      return '';
    return decodeHTML(reference);
  });
}

/** Python utils.py::is_image_file, with a bounded single scan for extension candidates. */
export function isImageFile(src: string | undefined): boolean {
  if (src === undefined) return false;
  if (src.length > 8192) {
    let count = 0;
    for (const _character of src) {
      if (++count > 8192) return false;
    }
  }
  for (const candidate of src.matchAll(/\.(?:avif|bmp|gif|hei[cf]|jpe?g|png|webp)/giu)) {
    if (candidate.index === 0 || isPySpaceCode(src.charCodeAt(candidate.index - 1))) continue;
    const next = src.codePointAt(candidate.index + candidate[0].length);
    if (next === undefined || !isPythonWord(next)) return true;
  }
  return false;
}

/** Python utils.py::is_image_element, including all data-src-prefixed fallbacks. */
export function isImageElement(tree: Tree, id: NodeId): boolean {
  if (isImageFile(tree.get(id, 'data-src')) || isImageFile(tree.get(id, 'src'))) return true;
  const node = tree.node(id);
  return node.attrNames.some(
    (name, index) => name.startsWith('data-src') && isImageFile(node.attrValues[index]),
  );
}

/** Python utils.py::FORMATTING_PROTECTED. */
export const FORMATTING_PROTECTED: ReadonlySet<string> = new Set([
  'cell',
  'head',
  'hi',
  'item',
  'p',
  'quote',
  'ref',
  'td',
]);

/** Python utils.py::LINK_FARM_RATIO. */
export const LINK_FARM_RATIO = 0.9;
