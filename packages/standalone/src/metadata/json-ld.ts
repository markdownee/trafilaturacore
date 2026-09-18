// SPDX-License-Identifier: Apache-2.0
//
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/json_metadata.py
//   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/json_metadata.py
//   trafilatura/metadata.py (extract_meta_json)
//   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh guarded traversal and fallback implementation. Constants below
// reproduce the pinned sets and patterns, with existing JavaScript regex adaptations.
// JSON controls/non-finite numbers, scalar guards and fallback work budgets are
// reimplemented first-party compatibility and resource boundaries.

import { MAX_JSON_AUTHOR_FALLBACK_UNITS, MAX_JSON_AUTHOR_RESCAN_UNITS } from '../core/settings.js';
import type { Metadata } from '../types.js';
import { normalizeAuthors } from './authors.js';
import { type HDocument, pythonLength } from './dom.js';
import { normalizeJson } from './text.js';

const JSON_ARTICLE_SCHEMA = new Set([
  'article',
  'backgroundnewsarticle',
  'blogposting',
  'medicalscholarlyarticle',
  'newsarticle',
  'opinionnewsarticle',
  'reportagenewsarticle',
  'scholarlyarticle',
  'socialmediaposting',
  'liveblogposting',
]);

const JSON_OGTYPE_SCHEMA = new Set([
  'aboutpage',
  'checkoutpage',
  'collectionpage',
  'contactpage',
  'faqpage',
  'itempage',
  'medicalwebpage',
  'profilepage',
  'qapage',
  'realestatelisting',
  'searchresultspage',
  'webpage',
  'website',
  'article',
  'advertisercontentarticle',
  'newsarticle',
  'analysisnewsarticle',
  'askpublicnewsarticle',
  'backgroundnewsarticle',
  'opinionnewsarticle',
  'reportagenewsarticle',
  'reviewnewsarticle',
  'report',
  'satiricalarticle',
  'scholarlyarticle',
  'medicalscholarlyarticle',
  'socialmediaposting',
  'blogposting',
  'liveblogposting',
  'discussionforumposting',
  'techarticle',
  'blog',
  'jobposting',
]);

const JSON_PUBLISHER_SCHEMA = new Set([
  'newsmediaorganization',
  'organization',
  'webpage',
  'website',
]);

const AUTHOR_ATTRS = ['givenName', 'additionalName', 'familyName'] as const;

const JSON_SCHEMA_ORG = /^https?:\/\/schema\.org/i;

// Regex-fallback patterns (extract_json_parse_error) for malformed JSON-LD.
const JSON_AUTHOR_1 =
  /"author":[^}[]+?"name?\\?": ?\\?"([^"\\]+)|"author"[^}[]+?"names?"[\s\S]+?"([^"]+)/;
const JSON_AUTHOR_2 = /"[Pp]erson"[^}]+?"names?"[\s\S]+?"([^"]+)/;
const JSON_AUTHOR_REMOVE =
  /,?(?:"\w+":?[:|,[])?\{?"@type":"(?:[Ii]mageObject|[Oo]rganization|[Ww]eb[Pp]age)",[^}[]+\}[\]|}]?/g;
const JSON_PUBLISHER = /"publisher":[^}]+?"name?\\?": ?\\?"([^"\\]+)/;
const JSON_TYPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: CPython whitespace intentionally includes C0 separators.
  /"@type"[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*:[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*"([^"]*)"/u;
const JSON_CATEGORY = /"articleSection": ?"([^"\\]+)/;
const JSON_NAME = /"@type":"[Aa]rticle", ?"name": ?"([^"\\]+)/;
const JSON_HEADLINE = /"headline": ?"([^"\\]+)/;

// JSON_MINIFY: collapse whitespace outside string literals (metadata.py JSON_MINIFY).
const JSON_MINIFY =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: CPython whitespace intentionally includes C0 separators.
  /("(?:\\.|[^"\\])*")|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/gu;

type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === 'string';
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** JSON.parse adapter for Python's non-strict controls and non-finite numbers. */
function pythonJson(source: string): unknown {
  const pieces: string[] = [];
  let quoted = false;
  let run = 0;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const code = source.charCodeAt(cursor);
    if (quoted && code === 92) {
      cursor += 1;
      continue;
    }
    if (code === 34) {
      quoted = !quoted;
      continue;
    }
    let replacement: string | undefined;
    let width = 1;
    if (quoted && code < 32) replacement = `\\u${code.toString(16).padStart(4, '0')}`;
    else if (!quoted) {
      const token = ['-Infinity', 'Infinity', 'NaN'].find((candidate) =>
        source.startsWith(candidate, cursor),
      );
      if (token) {
        replacement = 'null';
        width = token.length;
      }
    }
    if (replacement === undefined) continue;
    pieces.push(source.slice(run, cursor), replacement);
    cursor += width - 1;
    run = cursor + 1;
  }
  pieces.push(source.slice(run));
  const parsed: unknown = JSON.parse(pieces.join(''));
  return parsed;
}

function preferPublisher(
  current: string | undefined,
  candidate: unknown,
  type?: string,
): candidate is string {
  if (!string(candidate) || !candidate) return false;
  return (
    !current ||
    (type !== 'webpage' && pythonLength(candidate) > pythonLength(current)) ||
    (current.startsWith('http') && !candidate.startsWith('http'))
  );
}

function personName(value: unknown): string | undefined {
  if (string(value)) return value;
  if (!object(value) || ('@type' in value && value['@type'] !== 'Person')) return undefined;
  if ('name' in value) {
    const name = value.name;
    if (string(name)) return name;
    if (Array.isArray(name))
      return name
        .filter(string)
        .join('; ')
        .replace(/^[; ]+|[; ]+$/g, '');
    if (object(name) && string(name.name)) return name.name;
    return undefined;
  }
  if ('givenName' in value && 'familyName' in value) {
    return AUTHOR_ATTRS.map((field) => value[field])
      .filter(string)
      .join(' ');
  }
  return undefined;
}

class MetadataJson {
  constructor(private readonly metadata: Metadata) {}

  private author(value: unknown): void {
    let authors = value;
    if (string(value)) {
      try {
        authors = JSON.parse(value) as unknown;
      } catch {
        this.metadata.author = normalizeAuthors(this.metadata.author, value);
      }
    }
    for (const author of array(authors)) {
      const name = personName(author);
      if (name !== undefined) this.metadata.author = normalizeAuthors(this.metadata.author, name);
    }
  }

  private content(value: unknown): void {
    if (!object(value)) return;
    const metadata = this.metadata;
    if (object(value.publisher) && preferPublisher(metadata.sitename, value.publisher.name)) {
      metadata.sitename = value.publisher.name;
    }
    const rawType = value['@type'];
    const firstType: unknown = Array.isArray(rawType) ? rawType[0] : rawType;
    if (!string(firstType) || !firstType) return;
    const type = firstType.toLowerCase();
    if (!metadata.declaredPageType && JSON_OGTYPE_SCHEMA.has(type)) {
      metadata.declaredPageType = normalizeJson(type);
    }
    if (JSON_PUBLISHER_SCHEMA.has(type)) {
      // Nullish precedence is the existing product policy, including an empty name.
      const publisher = value.name ?? value.legalName ?? value.alternateName;
      if (preferPublisher(metadata.sitename, publisher, type)) metadata.sitename = publisher;
      return;
    }
    if (type === 'person') {
      if (string(value.name) && value.name && !value.name.startsWith('http')) {
        metadata.author = normalizeAuthors(metadata.author, value.name);
      }
      return;
    }
    if (!JSON_ARTICLE_SCHEMA.has(type)) return;
    if ('author' in value) this.author(value.author);
    if (!metadata.categories && 'articleSection' in value) {
      const section = value.articleSection;
      if (string(section)) metadata.categories = [section];
      else if (Array.isArray(section))
        metadata.categories = section.filter(
          (entry): entry is string => string(entry) && Boolean(entry),
        );
    }
    if (!metadata.title) {
      if (type === 'article' && string(value.name)) metadata.title = value.name;
      else if (string(value.headline)) metadata.title = value.headline;
    }
  }

  parsed(schema: unknown): void {
    for (const container of array(schema)) {
      if (
        !object(container) ||
        !string(container['@context']) ||
        !JSON_SCHEMA_ORG.test(container['@context'])
      )
        continue;
      let content: unknown = container;
      if ('@graph' in container) content = container['@graph'];
      else if (
        string(container['@type']) &&
        container['@type'].toLowerCase().includes('liveblogposting') &&
        'liveBlogUpdate' in container
      ) {
        content = container.liveBlogUpdate;
      }
      for (const entry of array(content)) this.content(entry);
    }
  }

  malformed(source: string): void {
    const metadata = this.metadata;
    const authorText = source.replace(JSON_AUTHOR_REMOVE, '');
    const author =
      fallbackAuthors(authorText, JSON_AUTHOR_1) ?? fallbackAuthors(authorText, JSON_AUTHOR_2);
    if (author) metadata.author = author;
    const type = JSON_TYPE.exec(source)?.[1];
    if (type) {
      const normalized = normalizeJson(type.toLowerCase());
      if (JSON_OGTYPE_SCHEMA.has(normalized)) metadata.declaredPageType = normalized;
    }
    const publisher = JSON_PUBLISHER.exec(source)?.[1];
    if (publisher && !publisher.includes(',')) {
      const candidate = normalizeJson(publisher);
      if (preferPublisher(metadata.sitename, candidate)) metadata.sitename = candidate;
    }
    const category = JSON_CATEGORY.exec(source)?.[1];
    if (category) metadata.categories = [normalizeJson(category)];
    if (!metadata.title) {
      const title = JSON_NAME.exec(source)?.[1] || JSON_HEADLINE.exec(source)?.[1];
      if (title) metadata.title = normalizeJson(title);
    }
  }
}

/** Truncate the input first, then charge each remove-and-rescan iteration. */
function fallbackAuthors(source: string, pattern: RegExp): string | undefined {
  let remaining = source.slice(0, MAX_JSON_AUTHOR_FALLBACK_UNITS);
  let work = 0;
  let result: string | undefined;
  for (;;) {
    const match = pattern.exec(remaining);
    const name = match?.slice(1).find(Boolean);
    if (!match || !name?.includes(' ')) return result;
    result = normalizeAuthors(result, name);
    work += remaining.length;
    if (work > MAX_JSON_AUTHOR_RESCAN_UNITS) return result;
    remaining = remaining.slice(0, match.index) + remaining.slice(match.index + match[0].length);
  }
}

export function extractJsonLd(document: HDocument, metadata: Metadata): void {
  const reader = new MetadataJson(metadata);
  for (const script of document.querySelectorAll('script[type]')) {
    const mime = script.getAttribute('type');
    if (mime !== 'application/ld+json' && mime !== 'application/settings+json') continue;
    if (!script.textContent) continue;
    const minified = script.textContent.replace(
      JSON_MINIFY,
      (_match, quoted?: string) => quoted ?? '',
    );
    const normalized = normalizeJson(minified);
    try {
      reader.parsed(pythonJson(normalized));
    } catch {
      reader.malformed(normalized);
    }
  }
}
