// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py (extract_metainfo)
//   trafilatura/xpaths.py (title/author/category selector families)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh TypeScript translation through the product's established DOM/CSS
// adapters, retaining their explicit first-party case/substring interpretation.

import { type HDocument, pythonLength, trim } from './dom.js';
import { iterText } from './text.js';

export function selectMetaInfo(
  document: HDocument,
  selectors: string[],
  lenLimit = 200,
): string | undefined {
  const root = document.body ?? document.documentElement;
  if (root === null) return undefined;
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      const text = trim(iterText(element));
      const length = pythonLength(text);
      if (length > 2 && length < lenLimit) return text;
    }
  }
  return undefined;
}
