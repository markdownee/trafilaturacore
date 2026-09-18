// SPDX-License-Identifier: Apache-2.0
//
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/metadata.py (extract_url, URL_SELECTORS)
//   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: URL selection is freshly translated into the metadata DOM adapter.
// URL validation, normalization and domain approximation are reimplemented
// first-party WHATWG policies. No Courlan implementation is included; earlier
// black-box observations used Courlan 1.4.0, e5a70a0cfdb89715b1a6d769639fdc0897eef542.

import type { HDocument, HElement } from './dom.js';

const TRACKERS = new Set(['fbclid', 'gclid', 'msclkid']);
const SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

function httpAddress(value: string): URL | undefined {
  try {
    const address = new URL(value);
    if (address.hostname && ['http:', 'https:'].includes(address.protocol)) return address;
  } catch {
    // Invalid metadata URLs are absent rather than extraction errors.
  }
  return undefined;
}

export function isValidUrl(value: string): boolean {
  if (!httpAddress(value)) return false;
  const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(value.trimStart())?.[1];
  if (!authority || authority.length < 5) return false;
  return !authority.startsWith('www.') || authority.length >= 8;
}

export function getBaseUrl(value: string): string | undefined {
  const address = httpAddress(value);
  return address && `${address.protocol}//${address.host}`;
}

function tracking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKERS.has(lower);
}

function queryString(parameters: URLSearchParams): string {
  const retained = new URLSearchParams();
  for (const [name, value] of parameters) {
    if (value && !tracking(name)) retained.append(name, value);
  }
  retained.sort();
  return retained.toString();
}

function canonicalize(value: string): string {
  const address = new URL(value);
  address.pathname = address.pathname.replace(/\/+/g, '/');
  address.search = queryString(address.searchParams);
  const fragment = address.hash.substring(1);
  const firstName = fragment.split('=', 1)[0] ?? '';
  if (fragment && tracking(firstName)) address.hash = '';
  else if (fragment.includes('=') && fragment.includes('&')) {
    address.hash = queryString(new URLSearchParams(fragment));
  }
  return address.href;
}

export function extractDomain(value: string): string | undefined {
  const address = httpAddress(value);
  if (!address) return undefined;
  const host = address.hostname.replace(/^www[0-9]*\./, '');
  if (host.includes(':')) return undefined;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return host;
  const parts = host.split('.');
  if (parts.length < 2) return undefined;
  const final = parts.at(-1) ?? '';
  const penultimate = parts.at(-2) ?? '';
  const width = parts.length >= 3 && final.length === 2 && SECOND_LEVEL.has(penultimate) ? 3 : 2;
  return parts.slice(-width).join('.');
}

function* linkCandidates(document: HDocument): Generator<HElement | undefined | null> {
  const links = [...document.querySelectorAll('head link[rel]')];
  yield links.find((link) => link.getAttribute('rel') === 'canonical');
  yield document.querySelector('head base');
  yield links.find(
    (link) =>
      link.getAttribute('rel') === 'alternate' && link.getAttribute('hreflang') === 'x-default',
  );
}

function declaredUrl(document: HDocument): string | undefined {
  for (const candidate of linkCandidates(document)) {
    const href = candidate?.getAttribute('href');
    if (href) return href;
  }
  return undefined;
}

function declaredBase(document: HDocument): string | undefined {
  for (const meta of document.head?.querySelectorAll('meta[content]') ?? []) {
    const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
    if (!name.startsWith('og:') && !name.startsWith('twitter:')) continue;
    const base = getBaseUrl(meta.getAttribute('content') ?? '');
    if (base) return base;
  }
  return undefined;
}

export function extractUrl(document: HDocument, defaultUrl?: string): string | undefined {
  let candidate = declaredUrl(document);
  if (candidate?.startsWith('/')) {
    const base = declaredBase(document);
    if (base) candidate = base + candidate;
  }
  return candidate && isValidUrl(candidate) ? canonicalize(candidate) : defaultUrl;
}
