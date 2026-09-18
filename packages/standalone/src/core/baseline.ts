// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/baseline.py
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/baseline.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: freshly translated rescue strategies over the product Tree interface.
// JSON compatibility, iterative JSON traversal, incremental dedupe lengths and bounded
// fragment parsing are first-party adapters; resource failures never become text fallbacks.

import { parseDocument } from './dom.js';
import { ExtractionError, isExtractionError } from './error.js';
import { BASIC_CLEAN_RULES } from './selectors.js';
import {
  BLOCK_ELEMS,
  DEDUPE_SCAN_CAP,
  MIN_CONTENT_LENGTH,
  MIN_DUPLICATE_LENGTH,
} from './settings.js';
import { charCount, type NodeId, type Tree } from './tree.js';
import { htmlUnescape, PY_SPACE_CLASS, removeControlCharacters, trim } from './utils.js';

interface TextBody {
  body: NodeId;
  text: string;
  length: number;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function list(value: unknown): unknown[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

/** Python json.loads extensions, implemented without altering quoted special-value text. */
function json(text: string, relaxed = false): unknown {
  let normalized = '';
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      else if (relaxed && character.charCodeAt(0) < 32) {
        normalized += `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
    } else if (character === '"') {
      quoted = true;
    } else {
      const special = ['-Infinity', 'Infinity', 'NaN'].find((word) => text.startsWith(word, index));
      if (special !== undefined) {
        normalized += 'null';
        index += special.length - 1;
        continue;
      }
    }
    normalized += character;
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return undefined;
  }
}

/** Python baseline.py::_walk_json; preserve depth-first container order without recursion. */
function walkJson(value: unknown, bodies: string[], teasers: string[]): void {
  const pending: unknown[] = [];
  const schedule = (item: unknown): void => {
    const items = list(item);
    for (let index = items.length - 1; index >= 0; index -= 1) pending.push(items[index]);
  };
  schedule(value);
  while (pending.length) {
    const item = object(pending.pop());
    if (item === undefined) continue;
    for (const key of ['articleBody', 'reviewBody']) {
      const text = item[key];
      if (typeof text === 'string' && text) bodies.push(text);
    }
    for (const key of ['recipeInstructions', 'step']) {
      for (const step of list(item[key])) {
        if (typeof step === 'string') {
          bodies.push(step);
          continue;
        }
        const entry = object(step);
        if (entry === undefined) continue;
        if (typeof entry.text === 'string') bodies.push(entry.text);
        for (const child of list(entry.itemListElement)) {
          const text = object(child)?.text;
          if (typeof text === 'string') bodies.push(text);
        }
      }
    }
    const answer = object(item.acceptedAnswer)?.text;
    if (typeof answer === 'string') bodies.push(answer);
    const type = JSON.stringify(item['@type'] ?? '');
    if (
      (type.includes('Product') || type.includes('VideoObject')) &&
      typeof item.description === 'string'
    )
      teasers.push(item.description);
    schedule(item.mainEntity);
    schedule(item['@graph']);
  }
}

/** Python baseline.py::_discourse_texts. */
export function discourseTexts(tree: Tree, root: NodeId): string[] {
  const node = tree.findDescendantWhere(
    root,
    (id) => tree.tag(id) === 'div' && tree.get(id, 'id') === 'data-preloaded',
  );
  const values =
    node === undefined ? undefined : object(json(tree.getOrEmpty(node, 'data-preloaded')));
  const texts: string[] = [];
  for (const [key, raw] of Object.entries(values ?? {})) {
    if (!key.startsWith('topic_') || typeof raw !== 'string') continue;
    const posts = object(object(json(raw))?.post_stream)?.posts;
    for (const post of list(posts)) {
      const text = object(post)?.cooked;
      if (typeof text === 'string') texts.push(text);
    }
  }
  return texts;
}

const JSON_HOOKS = [
  'articleBody',
  'reviewBody',
  'recipeInstructions',
  'acceptedAnswer',
  '"Product"',
  '"VideoObject"',
  '"HowTo"',
];
function embedded(tree: Tree, root: NodeId): { bodies: string[]; teasers: string[] } {
  const bodies: string[] = [];
  const teasers: string[] = [];
  for (const node of tree.iterDescendants(root)) {
    if (tree.tag(node) !== 'script' || tree.get(node, 'type') !== 'application/ld+json') continue;
    const text = tree.text(node);
    if (text && JSON_HOOKS.some((hook) => text.includes(hook)))
      walkJson(json(text, true), bodies, teasers);
  }
  for (const text of discourseTexts(tree, root)) bodies.push(text);
  return { bodies, teasers };
}

/** Python baseline.py::basic_cleaning, with one compaction per affected parent. */
export function basicCleaning(tree: Tree, root: NodeId): void {
  for (const rule of BASIC_CLEAN_RULES) {
    tree.deleteElementsBatch(
      tree.collectDescendantsWhere(root, (node) => rule(tree, node)),
      true,
    );
  }
}

const HTML_NAMES =
  'a|abbr|address|article|aside|b|blockquote|body|br|caption|cite|code|dd|del|div|dl|dt|em|' +
  'figcaption|figure|footer|h[1-6]|head|header|hr|html|i|img|ins|kbd|li|main|mark|nav|ol|p|pre|' +
  'q|quote|s|section|small|span|strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|time|title|tr|u|ul';
// Split attributes at their first '=': the accepted language is upstream's, without an
// ambiguous pair of overlapping unbounded runs on a missing closing angle bracket.
const MARKUP = new RegExp(
  `</(${HTML_NAMES})>|<(${HTML_NAMES})([${PY_SPACE_CLASS}][^<>=]*=[^<>]*)?/?>`,
  'i',
);

function rendered(raw: string): string {
  const text = removeControlCharacters(htmlUnescape(raw));
  if (MARKUP.test(text)) {
    try {
      const parsed = parseDocument(`<div>${text}</div>`);
      const error = parsed.tree.resourceError();
      if (error !== undefined) throw error;
      return trim(parsed.tree.itertext(parsed.root));
    } catch (error) {
      if (!isExtractionError(error) || error.isResourceLimit()) throw error;
    }
  }
  return trim(text);
}

/** Python baseline.py::_build_body and _attempt. */
function attempt(tree: Tree, texts: Iterable<string>, dedupe: boolean): TextBody | undefined {
  const body = tree.create('body');
  let text = '';
  let length = 0;
  for (const value of texts) {
    const paragraph = removeControlCharacters(value);
    if (!paragraph) continue;
    const size = charCount(paragraph);
    if (
      dedupe &&
      size > MIN_DUPLICATE_LENGTH &&
      length <= DEDUPE_SCAN_CAP &&
      text.includes(paragraph)
    ) {
      continue;
    }
    tree.setText(tree.createSub(body, 'p'), paragraph);
    if (text) {
      text += '\n';
      length += 1;
    }
    text += paragraph;
    length += size;
  }
  return length > MIN_CONTENT_LENGTH ? { body, text, length } : undefined;
}

function* renderedTexts(values: readonly string[]): Generator<string> {
  for (const value of values) yield rendered(value);
}

/** Pinned baseline cascade: embedded body, articles, paragraphs, teaser, document dump. */
export function baseline(tree: Tree, source: NodeId): TextBody {
  const root = tree.deepCopy(source);
  const content = embedded(tree, root);
  const fromJson = attempt(tree, renderedTexts(content.bodies), true);
  if (fromJson !== undefined) return fromJson;
  basicCleaning(tree, root);

  const articles: { text: string; length: number }[] = [];
  let largest = 0;
  for (const id of tree.iterDescendants(root)) {
    if (tree.tag(id) !== 'article' || tree.hasAncestor(id, 'article')) continue;
    const text = trim(tree.itertext(id));
    const length = charCount(text);
    if (length > MIN_CONTENT_LENGTH) {
      articles.push({ text, length });
      largest = Math.max(largest, length);
    }
  }
  if (articles.length) {
    const chosen = articles
      .filter((article) => article.length >= largest / 5)
      .map((article) => article.text);
    const fromArticles = attempt(tree, chosen, false);
    if (fromArticles !== undefined) return fromArticles;
  }

  const tags = new Set(['blockquote', 'code', 'p', 'pre', 'q', 'quote']);
  const paragraphs = tree
    .collectDescendantsWhere(root, (id) => tags.has(tree.tag(id)))
    .map((id) => trim(tree.itertext(id)));
  const fromParagraphs = attempt(tree, paragraphs, true);
  if (fromParagraphs !== undefined) return fromParagraphs;

  const teaser = attempt(tree, renderedTexts(content.teasers), true);
  const body = tree.create('body');
  const originalBody = tree.findDescendant(root, 'body');
  if (originalBody !== undefined) {
    const parts = tree.itertextParts(originalBody).map(trim).filter(Boolean);
    const text = removeControlCharacters(parts.join('\n'));
    const length = charCount(text);
    tree.setText(tree.createSub(body, 'p'), text);
    if (teaser === undefined || length >= teaser.length) return { body, text, length };
  }
  return teaser ?? { body, text: '', length: 0 };
}

/** Python baseline.py::html2txt; block boundaries remain separated even in minified input. */
export function html2txt(tree: Tree, source: NodeId, clean: boolean): string {
  const copy = tree.deepCopy(source);
  const body = tree.findDescendant(copy, 'body') ?? copy;
  if (clean) basicCleaning(tree, body);
  for (const node of tree.iterTree(body)) {
    if (!BLOCK_ELEMS.has(tree.tag(node))) continue;
    tree.setText(node, ` ${removeControlCharacters(tree.text(node) ?? '')}`);
    tree.setTail(node, ` ${removeControlCharacters(tree.tail(node) ?? '')}`);
  }
  return trim(tree.itertext(body));
}

export { ExtractionError };
