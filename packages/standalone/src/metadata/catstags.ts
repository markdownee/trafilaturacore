// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py (extract_catstags)
//   trafilatura/xpaths.py (CATEGORIES_XPATHS, TAGS_XPATHS)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh TypeScript translation through the product's established DOM/CSS
// adapters, retaining their explicit first-party case/substring interpretation.

import type { HDocument } from './dom.js';
import { lineProcessing } from './text.js';

function links(selectors: string[]): string {
  return selectors.map((selector) => `${selector} a[href]`).join(', ');
}
const CATEGORIES = [
  links([
    ...[
      'post-info',
      'postinfo',
      'post-meta',
      'postmeta',
      'meta',
      'entry-meta',
      'entry-info',
      'entry-utility',
    ].map((prefix) => `div[class^="${prefix}" i]`),
    'div[id^="postpath"]',
  ]),
  links([
    'p[class^="postmeta"]',
    'p[class^="entry-categories"]',
    'p[class="postinfo"]',
    'p[id="filedunder"]',
  ]),
  links(['footer[class^="entry-meta"]', 'footer[class^="entry-footer"]']),
  links(
    ['li', 'span'].flatMap((tag) => [
      ...['post-category', 'postcategory', 'entry-category'].map(
        (value) => `${tag}[class="${value}"]`,
      ),
      `${tag}[class*="cat-links" i]`,
    ]),
  ),
  links(['header[class="entry-header"]']),
  links(['div[class="row"]', 'div[class="tags"]']),
];
const TAGS = [
  links(['div[class="tags"]']),
  links(['p[class^="entry-tags"]']),
  links([
    'div[class="row"]',
    'div[class="jp-relatedposts"]',
    'div[class="entry-utility"]',
    ...['tag', 'postmeta', 'meta'].map((prefix) => `div[class^="${prefix}" i]`),
  ]),
  links(['[class="entry-meta"]', '[class*="topics" i]', '[class*="tags-links" i]']),
];

export function extractCatsTags(kind: 'category' | 'tag', document: HDocument): string[] {
  const results: string[] = [];
  const root = document.body ?? document.documentElement;
  const href = new RegExp(`/${kind.replace(/y$/, '')}(?:y|ies|s)?/`);
  if (root !== null) {
    for (const selector of kind === 'category' ? CATEGORIES : TAGS) {
      for (const element of root.querySelectorAll(selector)) {
        if (href.test(element.getAttribute('href') ?? '')) results.push(element.textContent);
      }
      if (results.length) break;
    }
  }
  if (kind === 'category' && !results.length && document.head !== null) {
    for (const element of document.head.querySelectorAll(
      'head meta[property="article:section"][content], head meta[name*="subject" i][content]',
    )) {
      const value = element.getAttribute('content');
      if (value) results.push(value);
    }
  }
  const normalized = new Set<string>();
  for (const result of results) {
    const text = result ? lineProcessing(result) : undefined;
    if (text) normalized.add(text);
  }
  return Array.from(normalized);
}
