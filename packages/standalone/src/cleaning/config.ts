// SPDX-License-Identifier: Apache-2.0
// Reconstructed from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/htmlprocessing.py (REND_TAG_MAPPING, HTML_CONVERSIONS, CONVERSIONS, convert_to_html, build_html_output)
//   trafilatura/settings.py (MANUALLY_CLEANED, MANUALLY_STRIPPED)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh assembly of the upstream output vocabulary and product whole-document
// sanitization policy. Upstream families and first-party preservation/handling policy
// remain explicit below. This is not a translation of a single upstream cleaner function.

import { MANUALLY_CLEANED, PRESERVE_IMG_CLEANING } from '../core/settings.js';
import type { ImageHandlingMode, LinkHandlingMode, TableHandlingMode } from '../types.js';

export interface CleanConfig {
  allowedTags?: string[];
  allowedAttributes?: Record<string, string[]>;
  allowedClasses?: Record<string, string[]>;
  selfClosing?: string[];
  nonTextTags?: string[];
  transformTags?: Record<string, string>;
}
export interface ContentHandling {
  tableHandling?: TableHandlingMode;
  imageHandling?: ImageHandlingMode;
  linkHandling?: LinkHandlingMode;
}

function frozen<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (item === null || typeof item !== 'object') continue;
    for (const child of Object.values(item)) pending.push(child);
    Object.freeze(item);
  }
  return value;
}

/** Provenance families, kept separate from the assembled sanitizer configuration. */
export const CLEAN_CONFIG_FAMILIES = frozen({
  // Upstream HTML_CONVERSIONS, formatting mapping and document-output scaffolding.
  canonicalOutputTags: [
    'html',
    'head',
    'meta',
    'body',
    'p',
    'blockquote',
    'pre',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'li',
    'table',
    'tr',
    'td',
    'th',
    'a',
    'img',
    'i',
    'strong',
    'u',
    'var',
    'sub',
    'sup',
    'del',
    'br',
  ],
  // First-party preservation policy for boilerplate=keep.
  wholeDocumentTags: [
    'title',
    'hr',
    'ol',
    'dl',
    'dt',
    'dd',
    'caption',
    'colgroup',
    'col',
    'figure',
    'figcaption',
    'picture',
    'source',
    'em',
    'b',
    's',
    'q',
    'code',
    'kbd',
    'samp',
  ],
  manuallyCleaned: [...MANUALLY_CLEANED],
  imageModeRescues: [...PRESERVE_IMG_CLEANING],
  unwrapInsteadOfDiscard: ['head', 'footer'],
  canonicalOutputAttributes: {
    meta: ['name', 'content'],
    a: ['href'],
    img: ['src', 'alt', 'title'],
  },
  // First-party attributes for whole-document structures.
  wholeDocumentAttributes: {
    html: ['lang'],
    meta: ['charset'],
    a: ['title'],
    img: ['width', 'height'],
    source: ['src', 'srcset', 'type', 'media'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    blockquote: ['cite'],
    q: ['cite'],
    col: ['span'],
    colgroup: ['span'],
    ol: ['start', 'type', 'reversed'],
    code: ['class'],
  },
  canonicalTransforms: { strike: 'del', tt: 'var' },
  legacyTransforms: { dir: 'ul', listing: 'pre', xmp: 'pre', plaintext: 'pre' },
  sanitizerVoidTags: ['img', 'br', 'hr', 'meta', 'source', 'col'],
  imageTags: ['img', 'figure', 'figcaption', 'picture', 'source'],
  imageNonTextTags: ['figure', 'picture', 'img', 'source'],
  tableTags: ['table', 'caption', 'tr', 'td', 'th', 'colgroup', 'col'],
});

function attributes(...groups: Record<string, string[]>[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const group of groups) {
    for (const [tag, names] of Object.entries(group)) {
      result[tag] = [...new Set([...(result[tag] ?? []), ...names])];
    }
  }
  return result;
}

const families = CLEAN_CONFIG_FAMILIES;
const retainedSubtrees = new Set([
  ...families.imageModeRescues,
  ...families.unwrapInsteadOfDiscard,
]);

export const DEFAULT_CLEAN_CONFIG: CleanConfig = frozen({
  allowedTags: [...new Set([...families.canonicalOutputTags, ...families.wholeDocumentTags])],
  allowedAttributes: attributes(
    families.canonicalOutputAttributes,
    families.wholeDocumentAttributes,
  ),
  selfClosing: [...families.sanitizerVoidTags],
  nonTextTags: families.manuallyCleaned.filter((tag) => !retainedSubtrees.has(tag)),
  transformTags: { ...families.canonicalTransforms, ...families.legacyTransforms },
});

/** Derive exclusions without mutating the caller, preserving identity for a no-op request. */
export function deriveContentConfig(base: CleanConfig, handling: ContentHandling): CleanConfig {
  const images = handling.imageHandling === 'exclude';
  const tables = handling.tableHandling === 'exclude';
  const links = handling.linkHandling === 'exclude';
  if (!images && !tables && !links) return base;
  const removed = new Set<string>();
  if (images) for (const tag of families.imageTags) removed.add(tag);
  if (tables) for (const tag of families.tableTags) removed.add(tag);
  if (links) removed.add('a');

  const output = { ...base };
  if (base.allowedTags !== undefined)
    output.allowedTags = base.allowedTags.filter((tag) => !removed.has(tag));
  const nonText = [...(images ? families.imageNonTextTags : []), ...(tables ? ['table'] : [])];
  if (nonText.length) {
    const existing = base.nonTextTags ?? [];
    output.nonTextTags = [...existing, ...nonText.filter((tag) => !existing.includes(tag))];
  }
  if (images) {
    const imageTags = new Set(families.imageTags);
    if (base.allowedAttributes !== undefined) {
      output.allowedAttributes = Object.fromEntries(
        Object.entries(base.allowedAttributes).filter(([tag]) => !imageTags.has(tag)),
      );
    }
    if (base.selfClosing !== undefined)
      output.selfClosing = base.selfClosing.filter((tag) => !imageTags.has(tag));
  }
  return output;
}
