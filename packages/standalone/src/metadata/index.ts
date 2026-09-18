// SPDX-License-Identifier: Apache-2.0
//
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py
//   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
//   trafilatura/settings.py
//   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/settings.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh orchestration of extract_metadata and partial clean_and_trim.
// Date inference is the first-party reduced heuristic, URL handling is local,
// and the existing sidecar policy excludes image from string cleanup.

import type { Metadata } from '../types.js';
import { extractAuthor } from './author-dom.js';
import { checkAuthors } from './authors.js';
import { extractCatsTags } from './catstags.js';
import { extractDate } from './date.js';
import { parseDocument, pythonLength, pythonSlice } from './dom.js';
import { extractJsonLd } from './json-ld.js';
import { extractLicense } from './license.js';
import { examineMeta } from './meta-tags.js';
import { normalizeSitename } from './sitename.js';
import { lineProcessing, unescapeHtml } from './text.js';
import { extractTitle } from './title.js';
import { extractDomain, extractUrl } from './url.js';

const CLEAN_FIELDS = [
  'title',
  'author',
  'url',
  'hostname',
  'description',
  'sitename',
  'date',
  'declaredPageType',
  'license',
] as const;
const OUTPUT_FIELDS = [
  'title',
  'author',
  'url',
  'hostname',
  'description',
  'sitename',
  'date',
  'categories',
  'tags',
  'image',
  'declaredPageType',
  'license',
] as const;

function finish(metadata: Metadata): Metadata {
  for (const field of CLEAN_FIELDS) {
    const value = metadata[field];
    if (typeof value !== 'string') continue;
    const bounded = pythonLength(value) > 10000 ? `${pythonSlice(value, 0, 9999)}…` : value;
    metadata[field] = lineProcessing(unescapeHtml(bounded));
  }
  const result: Metadata = {
    title: metadata.title,
    author: metadata.author,
    url: metadata.url,
    hostname: metadata.hostname,
    description: metadata.description,
    sitename: metadata.sitename,
    date: metadata.date,
    categories: metadata.categories,
    tags: metadata.tags,
    image: metadata.image,
    declaredPageType: metadata.declaredPageType,
    license: metadata.license,
  };
  for (const field of OUTPUT_FIELDS) {
    const value = result[field];
    if (!value || value.length === 0) delete result[field];
  }
  return result;
}

function allowedAuthor(
  author: string | undefined,
  blacklist: ReadonlySet<string> | undefined,
): string | undefined {
  return author && blacklist?.size ? checkAuthors(author, blacklist) : author;
}

export function extractMetadata(
  html: string,
  url?: string,
  authorBlacklist?: ReadonlySet<string>,
): Metadata {
  const document = parseDocument(html);
  const metadata = examineMeta(document);
  if (metadata.author && !metadata.author.includes(' ')) metadata.author = undefined;
  try {
    extractJsonLd(document, metadata);
  } catch {
    // Upstream treats JSON metadata errors as non-fatal.
  }
  metadata.title ||= extractTitle(document);
  metadata.author = allowedAuthor(metadata.author, authorBlacklist);
  metadata.author ||= extractAuthor(document);
  metadata.author = allowedAuthor(metadata.author, authorBlacklist);
  metadata.url ||= extractUrl(document, url);
  if (metadata.url) metadata.hostname = extractDomain(metadata.url);
  metadata.date = extractDate(document, metadata.url);
  metadata.sitename = normalizeSitename(document, metadata.sitename, metadata.url);
  if (!metadata.categories?.length) metadata.categories = extractCatsTags('category', document);
  if (!metadata.tags?.length) metadata.tags = extractCatsTags('tag', document);
  metadata.license = extractLicense(document);
  return finish(metadata);
}
