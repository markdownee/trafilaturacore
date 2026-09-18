// SPDX-License-Identifier: Apache-2.0
//
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py
//   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh property-table translation with the first-party HTML DOM
// and URL validation adapters. Descendant head selectors preserve the product
// contract; repeated properties still replace earlier values.

import { normalizeAuthors } from './authors.js';
import { type HDocument, trim } from './dom.js';
import { isValidUrl } from './url.js';

interface OpenGraphResult {
  title?: string;
  author?: string;
  url?: string;
  description?: string;
  sitename?: string;
  image?: string;
  pagetype?: string;
}

const FIELDS = new Map<string, keyof OpenGraphResult>([
  ['og:title', 'title'],
  ['og:description', 'description'],
  ['og:site_name', 'sitename'],
  ['og:image', 'image'],
  ['og:image:url', 'image'],
  ['og:image:secure_url', 'image'],
  ['og:type', 'pagetype'],
]);

export function extractOpenGraph(document: HDocument): OpenGraphResult {
  const output: OpenGraphResult = {};
  for (const element of document.head?.querySelectorAll('meta[property^="og:"]') ?? []) {
    const property = element.getAttribute('property') ?? '';
    const content = element.getAttribute('content');
    if (content === null || !trim(content)) continue;
    const destination = FIELDS.get(property);
    if (destination) output[destination] = content;
    else if (property === 'og:url') {
      if (isValidUrl(content)) output.url = content;
    } else if (property === 'og:author' || property === 'og:article:author') {
      output.author = normalizeAuthors(undefined, content);
    }
  }
  return output;
}
