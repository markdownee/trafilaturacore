// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py (extract_sitename, extract_metadata sitename normalization)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh TypeScript translation through the product's established DOM/CSS
// adapters, retaining their explicit first-party case/substring interpretation.

import type { HDocument } from './dom.js';
import { pythonFirstCharIsUpper, pythonTitle } from './python-case.js';
import { examineTitleElement } from './title.js';

export function extractSitename(document: HDocument): string | undefined {
  const title = examineTitleElement(document);
  return [title.first, title.second].find((value) => value?.includes('.'));
}
export function normalizeSitename(
  document: HDocument,
  current: string | undefined,
  url: string | undefined,
): string | undefined {
  const source = current ?? extractSitename(document);
  if (!source) return url ? /^https?:\/\/(?:www\.|w[0-9]+\.)?([^/]+)/.exec(url)?.[1] : undefined;
  const name = source.replace(/^@+/, '');
  if (!name) return undefined;
  return !name.includes('.') && !pythonFirstCharIsUpper(name) ? pythonTitle(name) : name;
}
