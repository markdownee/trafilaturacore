// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py (extract_title, examine_title_element, HTMLTITLE_REGEX)
//   trafilatura/xpaths.py (TITLE_XPATHS)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh TypeScript translation through the product's established DOM/CSS
// adapters, retaining their explicit first-party case/substring interpretation.

import { PY_SPACE_CLASS } from '../core/utils.js';
import { type HDocument, trim } from './dom.js';
import { selectMetaInfo } from './xpath-css.js';

interface TitleParts {
  title: string;
  first?: string;
  second?: string;
}
const SPLIT_TITLE = new RegExp(
  `^(.+)?[${PY_SPACE_CLASS}]+[–•·—|⁄*⋆~‹«<›»>:-][${PY_SPACE_CLASS}]+(.+)$`,
  'u',
);
export function examineTitleElement(document: HDocument): TitleParts {
  const element = document.querySelector('head title') ?? document.querySelector('title');
  const title = element === null ? '' : trim(element.textContent);
  const split = SPLIT_TITLE.exec(title);
  return split ? { title, first: split[1], second: split[2] } : { title };
}
const TITLE_SELECTORS = [
  [
    ...['post-title', 'entry-title', 'article-title', 'post__title', 'headline'].flatMap((token) =>
      ['h1', 'h2'].map((tag) => `${tag}[class*="${token}" i]`),
    ),
    ...['id', 'itemprop'].flatMap((name) =>
      ['h1', 'h2'].map((tag) => `${tag}[${name}*="headline" i]`),
    ),
  ].join(', '),
  '[class="entry-title"], [class="post-title"]',
  ['class', 'id']
    .flatMap((name) => ['h1', 'h2', 'h3'].map((tag) => `${tag}[${name}*="title" i]`))
    .join(', '),
];

export function extractTitle(document: HDocument): string | undefined {
  const root = document.body ?? document.documentElement;
  if (root === null) return undefined;
  const headings = Array.from(root.querySelectorAll('h1'), (node) => trim(node.textContent));
  if (headings.length === 1 && headings[0]) return headings[0];
  const selected = selectMetaInfo(document, TITLE_SELECTORS, 200);
  if (selected) return selected;
  const parts = examineTitleElement(document);
  const fromTitle = [parts.first, parts.second, parts.title].find(
    (value) => value && !value.includes('.'),
  );
  if (fromTitle) return fromTitle;
  const firstHeading = headings.find(Boolean);
  if (firstHeading) return firstHeading;
  return trim(root.querySelector('h2')?.textContent ?? '') || parts.title || undefined;
}
