// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py (extract_license, parse_license_element, LICENSE_REGEX, TEXT_LICENSE_REGEX)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh TypeScript translation through the product's established DOM/CSS
// adapters, retaining their explicit first-party case/substring interpretation.

import { type HDocument, type HElement, trim } from './dom.js';

function declared(element: HElement, strict: boolean): string | undefined {
  const link = /\/(by-nc-nd|by-nc-sa|by-nc|by-nd|by-sa|by|zero)\/([1-9]\.[0-9])/.exec(
    element.getAttribute('href') ?? '',
  );
  if (link?.[1] && link[2]) return `CC ${link[1].toUpperCase()} ${link[2]}`;
  const text = trim(element.textContent);
  if (!text) return undefined;
  return strict
    ? /(cc|creative commons) (by-nc-nd|by-nc-sa|by-nc|by-nd|by-sa|by|zero) ?([1-9]\.[0-9])?/i.exec(
        text,
      )?.[0]
    : text;
}

export function extractLicense(document: HDocument): string | undefined {
  const root = document.body ?? document.documentElement;
  if (root === null) return undefined;
  const stages = [
    { selector: 'a[rel="license" i][href]', strict: false },
    {
      selector: 'footer a[href], div[class*="footer" i] a[href], div[id*="footer" i] a[href]',
      strict: true,
    },
  ];
  for (const stage of stages) {
    for (const element of root.querySelectorAll(stage.selector)) {
      const licence = declared(element, stage.strict);
      if (licence !== undefined) return licence;
    }
  }
  return undefined;
}
