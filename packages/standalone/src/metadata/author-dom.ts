// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py (extract_author, extract_metainfo)
//   trafilatura/xpaths.py (AUTHOR_XPATHS, AUTHOR_DISCARD_XPATHS)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh composition of the existing product's CSS-subset interpretation.
// Its broader case-insensitive substring predicates are first-party adaptations of
// the upstream XPath vocabulary, not a claim of complete XPath equivalence.

import { normalizeAuthors } from './authors.js';
import { type HDocument, pythonLength, trim } from './dom.js';
import { iterText } from './text.js';

function tagged(tags: readonly string[], condition: string): string[] {
  return tags.map((tag) => tag + condition);
}
const TEXT_TAGS = ['a', 'div', 'p', 'span', 'strong'];
const DISCARD = [
  ...['[id="comments"]', '[class="comments"]', '[class="title"]', '[class="date"]'].flatMap(
    (condition) => tagged(['a', 'div', 'section', 'span'], condition),
  ),
  '[id*="comment" i]',
  '[id*="ProductReviews" i]',
  ...[
    'comment',
    'sidebar',
    'is-hidden',
    'quote',
    'embedly-instagram',
    'article-share',
    'article-support',
    'print',
    'category',
    'meta-date',
    'meta-reviewer',
  ].map((token) => `[class*="${token}" i]`),
  '[data-component*="Figure" i]',
  'time',
  'figure',
].join(', ');
const SELECTORS = [
  [
    ...tagged(['a', 'address', 'div', 'link', 'p', 'span', 'strong'], '[rel="author" i]'),
    ...tagged(TEXT_TAGS, '[id="author"]'),
    ...tagged(TEXT_TAGS, '[class="author"]'),
    '[itemprop="author name"]',
    '[data-testid="AuthorCard"]',
    '[data-testid="AuthorURL"]',
    ...['author-name', 'authorname'].flatMap((token) =>
      tagged(['a', 'span'], `[class*="${token}" i]`),
    ),
    ...tagged(['div', 'p', 'strong'], '[class*="author-name" i]'),
    'author',
  ].join(', '),
  [
    ...tagged(['a', 'div', 'h3', 'h4', 'p', 'span'], '[class="byline"]'),
    '[class="username"]',
    '[class="byl"]',
    '[class="BBL"]',
    '[itemprop*="author" i]',
    '[id*="author" i]',
    ...['author', 'channel-name', 'submitted-by', 'posted-by', 'journalist-name'].map(
      (token) => `[class*="${token}" i]`,
    ),
  ].join(', '),
  '[data-component*="Byline" i], [itemprop*="author" i], [id*="author" i], ' +
    '[class*="author" i], [class*="screenname" i], [class*="writer" i], [class*="byline" i]',
];

export function extractAuthor(document: HDocument): string | undefined {
  const source = document.body ?? document.documentElement;
  if (source === null) return undefined;
  const tree = source.cloneNode(true);
  for (const node of tree.querySelectorAll(DISCARD)) node.remove();
  for (const selector of SELECTORS) {
    for (const node of tree.querySelectorAll(selector)) {
      const text = trim(iterText(node));
      const size = pythonLength(text);
      if (size > 2 && size < 120) return normalizeAuthors(undefined, text);
    }
  }
  return undefined;
}
