// SPDX-License-Identifier: Apache-2.0
//
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py
//   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh table-driven translation of examine_meta and normalize_tags.
// The OpenGraph bootstrap is a sibling module; HTML descendant selectors and
// the product's twitter:url-only policy are retained.

import type { Metadata } from '../types.js';
import { normalizeAuthors } from './authors.js';
import { type HDocument, pythonStrip, trim } from './dom.js';
import { extractOpenGraph } from './opengraph.js';
import { stripHtmlTags, unescapeHtml } from './text.js';
import { isValidUrl } from './url.js';

type NamedField = 'author' | 'title' | 'description' | 'sitename' | 'image' | 'tags';
const NAME_GROUPS: ReadonlyArray<readonly [NamedField, readonly string[]]> = [
  [
    'author',
    [
      'article:author',
      'atc-metaauthor',
      'author',
      'authors',
      'byl',
      'citation_author',
      'creator',
      'dc.creator',
      'dc.creator.aut',
      'dc:creator',
      'dcterms.creator',
      'dcterms.creator.aut',
      'dcsext.author',
      'parsely-author',
      'rbauthors',
      'sailthru.author',
      'shareaholic:article_author_name',
    ],
  ],
  [
    'title',
    [
      'citation_title',
      'dc.title',
      'dcterms.title',
      'fb_title',
      'headline',
      'parsely-title',
      'sailthru.title',
      'shareaholic:title',
      'rbtitle',
      'title',
      'twitter:title',
    ],
  ],
  [
    'description',
    [
      'dc.description',
      'dc:description',
      'dcterms.abstract',
      'dcterms.description',
      'description',
      'sailthru.description',
      'twitter:description',
    ],
  ],
  [
    'sitename',
    [
      'article:publisher',
      'citation_journal_title',
      'copyright',
      'dc.publisher',
      'dc:publisher',
      'dcterms.publisher',
      'publisher',
      'sailthru.publisher',
      'rbpubname',
      'twitter:site',
    ],
  ],
  [
    'image',
    [
      'image',
      'og:image',
      'og:image:url',
      'og:image:secure_url',
      'twitter:image',
      'twitter:image:src',
    ],
  ],
  [
    'tags',
    [
      'citation_keywords',
      'dcterms.subject',
      'keywords',
      'parsely-tags',
      'shareaholic:keywords',
      'tags',
    ],
  ],
];
const NAME_FIELDS = new Map(
  NAME_GROUPS.flatMap(([field, names]) => names.map((name) => [name, field] as const)),
);
const PROPERTY_FIELDS = new Map<string, NamedField>([
  ['article:tag', 'tags'],
  ['author', 'author'],
  ['article:author', 'author'],
  ['article:publisher', 'sitename'],
  ...NAME_GROUPS.filter(([field]) => field === 'image').flatMap(([field, names]) =>
    names.map((name) => [name, field] as const),
  ),
]);
const ITEM_FIELDS = new Map<string, NamedField>([
  ['author', 'author'],
  ['description', 'description'],
  ['headline', 'title'],
]);
const BOOTSTRAP_FIELDS = ['title', 'author', 'url', 'description', 'sitename', 'image'] as const;

function merge(
  metadata: Metadata,
  tags: string[],
  field: NamedField | undefined,
  content: string,
): void {
  if (!field) return;
  if (field === 'author') metadata.author = normalizeAuthors(metadata.author, content);
  else if (field === 'tags') {
    const value = trim(unescapeHtml(content)).replace(/["']/g, '');
    tags.push(value.split(', ').filter(Boolean).join(', '));
  } else if (!metadata[field]) metadata[field] = content;
}

export function examineMeta(document: HDocument): Metadata {
  const bootstrap = extractOpenGraph(document);
  const metadata: Metadata = {};
  for (const key of BOOTSTRAP_FIELDS) {
    if (bootstrap[key]) metadata[key] = bootstrap[key];
  }
  if (bootstrap.pagetype) metadata.declaredPageType = bootstrap.pagetype;
  const tags: string[] = [];
  metadata.tags = tags;
  if (BOOTSTRAP_FIELDS.every((key) => Boolean(metadata[key]))) return metadata;

  let backup: string | undefined;
  for (const element of document.head?.querySelectorAll('meta[content]') ?? []) {
    const content = pythonStrip(stripHtmlTags(element.getAttribute('content') ?? ''));
    if (!content) continue;
    if (element.hasAttribute('property')) {
      const name = (element.getAttribute('property') ?? '').toLowerCase();
      if (!name.startsWith('og:')) merge(metadata, tags, PROPERTY_FIELDS.get(name), content);
      continue;
    }
    if (element.hasAttribute('name')) {
      const name = (element.getAttribute('name') ?? '').toLowerCase();
      const field = NAME_FIELDS.get(name);
      if (field) merge(metadata, tags, field, content);
      else if (name === 'application-name' || name.includes('twitter:app:name')) backup = content;
      else if (name === 'twitter:url' && !metadata.url && isValidUrl(content))
        metadata.url = content;
      continue;
    }
    const item = (element.getAttribute('itemprop') ?? '').toLowerCase();
    merge(metadata, tags, ITEM_FIELDS.get(item), content);
  }
  if (!metadata.sitename) metadata.sitename = backup;
  return metadata;
}
