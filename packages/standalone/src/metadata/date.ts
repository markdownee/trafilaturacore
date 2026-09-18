// SPDX-License-Identifier: Apache-2.0
// First-party reduced date policy, reimplemented from its public behavior.
// This does not contain htmldate code. It intentionally validates component
// ranges only and probes the first match in each candidate string.

import type { HDocument } from './dom.js';

const DATE_TEXT = /(\d{4})-(\d{2})-(\d{2})/;
const DATE_PATH = /\/(\d{4})[/-](\d{2})[/-](\d{2})(?:[/-]|$)/;
const JSON_DATES = [/"datePublished"\s*:\s*"([^"]+)"/, /"dateModified"\s*:\s*"([^"]+)"/];
const META_DATES = [
  ['property', 'article:published_time'],
  ['name', 'date'],
  ['name', 'dcterms.date'],
  ['name', 'datePublished'],
  ['property', 'og:updated_time'],
] as const;

function dateComponents(match: RegExpExecArray | null): string | undefined {
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

function textDate(value: string | null | undefined): string | undefined {
  return value ? dateComponents(DATE_TEXT.exec(value)) : undefined;
}

function* candidates(document: HDocument): Generator<string | null | undefined> {
  for (const script of document.querySelectorAll('script[type]')) {
    const type = script.getAttribute('type');
    if (type === 'application/ld+json' || type === 'application/settings+json') {
      for (const pattern of JSON_DATES) yield pattern.exec(script.textContent)?.[1];
    }
  }
  for (const [attribute, value] of META_DATES) {
    yield document.head?.querySelector(`meta[${attribute}="${value}" i]`)?.getAttribute('content');
  }
  const root = document.body ?? document.documentElement;
  if (root) {
    for (const element of root.querySelectorAll('time[datetime]'))
      yield element.getAttribute('datetime');
  }
}

export function extractDate(document: HDocument, url?: string): string | undefined {
  for (const candidate of candidates(document)) {
    const date = textDate(candidate);
    if (date) return date;
  }
  return url ? dateComponents(DATE_PATH.exec(url)) : undefined;
}
