// SPDX-License-Identifier: Apache-2.0
// First-party pre-sanitize image policy. Extraction modes see only attributes retained
// by the upstream extractor; whole-document mode can also use picture, ARIA and captions.
// URL resolution is lexical only. Every result still crosses the sanitizer/security floor.

import {
  countThroughTemplates,
  type HDocument,
  type HElement,
  parseDocument,
  querySelectorAllThroughTemplates,
  trim,
} from '../metadata/dom.js';
import type { Message } from '../types.js';
import { isHtmlDocument } from './normalize.js';

export interface ImagePassOptions {
  mode: 'alt-text' | 'resolved-url';
  baseUrl?: string;
}
export interface ImagePassResult {
  html: string;
  messages: Message[];
}
interface SrcsetCandidate {
  url: string;
  width?: number;
  density?: number;
}

export function readBaseHref(rawHtml: string): string | undefined {
  const value = parseDocument(rawHtml).querySelector('base[href]')?.getAttribute('href')?.trim();
  if (!value) return undefined;
  try {
    new URL(value);
    return value;
  } catch {
    return undefined;
  }
}

function space(value: string | undefined): boolean {
  return value !== undefined && ' \t\n\f\r'.includes(value);
}

/** Scan URLs before descriptors, so the comma in a data URI is not a candidate separator. */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const result: SrcsetCandidate[] = [];
  let position = 0;
  while (position < value.length) {
    while (space(value[position]) || value[position] === ',') position += 1;
    const start = position;
    while (position < value.length && !space(value[position])) position += 1;
    let end = position;
    while (end > start && value[end - 1] === ',') end -= 1;
    const candidate: SrcsetCandidate = { url: value.slice(start, end) };
    if (end === position) {
      while (position < value.length) {
        while (space(value[position])) position += 1;
        if (value[position] === ',') {
          position += 1;
          break;
        }
        if (position === value.length) break;
        const from = position;
        while (position < value.length && !space(value[position]) && value[position] !== ',')
          position += 1;
        const descriptor = /^(\d+(?:\.\d+)?)([wx])$/i.exec(value.slice(from, position));
        if (descriptor !== null) {
          const size = Number(descriptor[1]);
          if (descriptor[2]?.toLowerCase() === 'w') candidate.width = size;
          else candidate.density = size;
        }
      }
    }
    if (candidate.url && !candidate.url.toLowerCase().startsWith('data:')) result.push(candidate);
  }
  return result;
}

function largest(candidates: readonly SrcsetCandidate[]): string | undefined {
  const useWidth = candidates.some((candidate) => candidate.width !== undefined);
  let best: SrcsetCandidate | undefined;
  let rank = -Infinity;
  for (const candidate of candidates) {
    if (useWidth && candidate.width === undefined) continue;
    const value = useWidth ? (candidate.width ?? 0) : (candidate.density ?? 1);
    if (best === undefined || value > rank) {
      best = candidate;
      rank = value;
    }
  }
  return best?.url;
}

function usable(value: string | null): string | undefined {
  const url = value?.trim();
  return url && !url.toLowerCase().startsWith('data:') ? url : undefined;
}

function source(image: HElement, picture: readonly SrcsetCandidate[]): string | undefined {
  for (const name of ['data-src', 'src']) {
    const value = usable(image.getAttribute(name));
    if (value !== undefined) return value;
  }
  for (const attribute of image.attributes) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith('data-src') && name !== 'data-src' && name !== 'data-srcset') {
      const value = usable(attribute.value);
      if (value !== undefined) return value;
    }
  }
  const set = image.getAttribute('srcset') ?? image.getAttribute('data-srcset');
  const own = set === null ? [] : parseSrcset(set);
  return largest(own.length ? own : picture);
}

function pictures(
  document: HDocument,
  mode: ImagePassOptions['mode'],
): Map<HElement, SrcsetCandidate[]> {
  const sources = new Map<HElement, SrcsetCandidate[]>();
  for (const picture of querySelectorAllThroughTemplates(document, 'picture')) {
    const image = picture.querySelector('img');
    if (image === null) {
      picture.remove();
      continue;
    }
    if (mode === 'resolved-url') {
      const candidates: SrcsetCandidate[] = [];
      for (const source of picture.querySelectorAll('source')) {
        const raw = source.getAttribute('srcset') ?? source.getAttribute('data-srcset');
        if (raw !== null) for (const candidate of parseSrcset(raw)) candidates.push(candidate);
      }
      if (candidates.length) sources.set(image, candidates);
    }
    picture.replaceWith(image);
  }
  return sources;
}

function alt(
  image: HElement,
  document: HDocument,
): { text: string | undefined; decorative: boolean } {
  const explicit = image.getAttribute('alt');
  if (explicit !== null) {
    const text = trim(explicit);
    return { text: text || undefined, decorative: !text };
  }
  const figure = image.closest('figure');
  if (figure !== null && countThroughTemplates(figure, 'img', 1) === 1) {
    const caption = trim(figure.querySelector('figcaption')?.textContent ?? '');
    if (caption) return { text: caption, decorative: false };
  }
  const label = trim(image.getAttribute('aria-label') ?? '');
  if (label) return { text: label, decorative: false };
  const descriptions: string[] = [];
  for (const id of (image.getAttribute('aria-labelledby') ?? '').split(/\s+/)) {
    if (!id || id.includes('"') || id.includes('\\')) continue;
    const text = trim(document.querySelector(`[id="${id}"]`)?.textContent ?? '');
    if (text) descriptions.push(text);
  }
  const labelled = descriptions.join(' ');
  if (labelled) return { text: labelled, decorative: false };
  return { text: trim(image.getAttribute('title') ?? '') || undefined, decorative: false };
}

const KEEP = new Set(['src', 'alt', 'title', 'width', 'height']);

export function applyImageHandling(html: string, options: ImagePassOptions): ImagePassResult {
  const document = parseDocument(html);
  const fallback = pictures(document, options.mode);
  const figures = querySelectorAllThroughTemplates(document, 'figure').filter(
    (figure) => countThroughTemplates(figure, 'img', 0) > 0,
  );
  let unresolved = 0;
  for (const image of querySelectorAllThroughTemplates(document, 'img')) {
    if (options.mode === 'alt-text') {
      const derived = alt(image, document);
      if (derived.decorative) image.remove();
      else {
        const placeholder = document.createElement('img');
        if (derived.text !== undefined) placeholder.setAttribute('alt', derived.text);
        image.replaceWith(placeholder);
      }
      continue;
    }
    const candidate = source(image, fallback.get(image) ?? []);
    for (const attribute of [...image.attributes]) {
      if (!KEEP.has(attribute.name.toLowerCase())) image.removeAttribute(attribute.name);
    }
    if (candidate === undefined) continue;
    let resolved = candidate;
    try {
      resolved = new URL(candidate, options.baseUrl).toString();
    } catch {
      unresolved += 1;
    }
    image.setAttribute('src', resolved);
  }
  for (const figure of figures) {
    if (countThroughTemplates(figure, 'img', 0) === 0) figure.remove();
  }
  const messages: Message[] = unresolved
    ? [
        {
          type: 'warning',
          text:
            "imageHandling 'resolved-url': no base URL (no url option, no <base href>) — " +
            unresolved +
            ' relative image URL(s) left as authored',
        },
      ]
    : [];
  return {
    html: isHtmlDocument(html) ? String(document) : (document.body?.innerHTML ?? ''),
    messages,
  };
}
