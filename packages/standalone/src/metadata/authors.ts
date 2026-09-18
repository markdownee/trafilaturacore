// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/json_metadata.py (AUTHOR_* vocabulary, normalize_authors)
//   trafilatura/metadata.py (check_authors)
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh translation with pinned Unicode predicates, the established first-party
// author-count cap, and a forward-only nickname scanner replacing backtracking.

import { MAX_AUTHOR_NAMES } from '../core/settings.js';
import { PY_SPACE_CLASS } from '../core/utils.js';
import { pythonLength, pythonStrip, trim } from './dom.js';
import { pythonFirstCharIsUpper, pythonTitle } from './python-case.js';
import { stripHtmlTags, unescapeHtml } from './text.js';
import { PYTHON_312_DECIMAL_CLASS, PYTHON_312_WORD_CLASS } from './unicode-15.js';

const WORD = PYTHON_312_WORD_CLASS;
const EMAIL = new RegExp(`^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}(?![${WORD}])`, 'u');
const SPLIT = new RegExp(`\\/|;|,|\\||&|(?:^|[^${WORD}])[uUaA][nN][dD](?:$|[^${WORD}])`, 'u');
const TWITTER = new RegExp(`@[${WORD}]+`, 'gu');
const SPECIAL = new RegExp(`[^${WORD}]+$|[:()?*$#!%/<>{}~¿]`, 'gu');
const PREFIX = /^([a-zäöüß]+(?:ed|t))? ?(?:written by|words by|words|by|von|from) /i;
const NUMBERS = new RegExp(`[${PYTHON_312_DECIMAL_CLASS}][\\s\\S]+?$`, 'u');
const PREPOSITIONS = ['am', 'on', 'for', 'at', 'in', 'to', 'from', 'of', 'via', 'with']
  .map((word) => [...word].map((letter) => `[${letter}${letter.toUpperCase()}]`).join(''))
  .join('|');
const PREPOSITION = new RegExp(
  '(?<=[' +
    WORD +
    '])[' +
    PY_SPACE_CLASS +
    ']+(?:' +
    PREPOSITIONS +
    '|—|-|–)[' +
    PY_SPACE_CLASS +
    ']+([\\s\\S]*)',
  'u',
);
const EMOJI =
  /[✀-➾\u{1f600}-\u{1f64f}☀-⛿\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1fa70}-\u{1faff}\u{1f680}-\u{1f6ff}]+/gu;
const OPENERS = new Set(['"', '‘', '(', '{', '[', '’', "'"]);
const CLOSERS = new Set(['‘', '’', '"', "'", ')', ']', '}']);

/** The pinned lazy nickname pattern, implemented with two monotonically advancing cursors. */
export function removeNicknames(value: string): string {
  const kept: string[] = [];
  let copied = 0;
  let closing = 0;
  let position = 0;
  while (position < value.length) {
    if (
      !OPENERS.has(value.charAt(position)) ||
      position + 1 >= value.length ||
      value.charAt(position + 1) === '"'
    ) {
      position += 1;
      continue;
    }
    closing = Math.max(closing, position + 2);
    while (closing < value.length && !CLOSERS.has(value.charAt(closing))) closing += 1;
    if (closing === value.length) break;
    if (position > copied) kept.push(value.slice(copied, position));
    position = closing + 1;
    copied = position;
  }
  kept.push(value.slice(copied));
  return kept.join('');
}

export function normalizeAuthors(
  current: string | undefined,
  authorString: string,
): string | undefined {
  if (authorString.toLowerCase().startsWith('http') || EMAIL.test(authorString)) return current;
  let source = authorString;
  if (source.includes('\\u')) {
    source = source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    );
  }
  if (source.includes('&#') || source.includes('&amp;')) source = unescapeHtml(source);
  const names = current ? current.split('; ') : [];
  const known = new Set(names);
  const before = names.length;
  for (const part of stripHtmlTags(source).split(SPLIT)) {
    if (names.length >= MAX_AUTHOR_NAMES) break;
    let name = trim(part).replace(EMOJI, '').replace(TWITTER, '');
    name = removeNicknames(trim(name.replace(/[._+]/g, ' ')));
    name = name
      .replace(SPECIAL, '')
      .replace(PREFIX, '')
      .replace(NUMBERS, '')
      .replace(PREPOSITION, '');
    if (!name || (pythonLength(name) >= 50 && !name.includes(' ') && !name.includes('-'))) continue;
    if (!pythonFirstCharIsUpper(name)) name = pythonTitle(name);
    if (!known.has(name)) {
      known.add(name);
      names.push(name);
    }
  }
  if (names.length === before && names.length >= MAX_AUTHOR_NAMES) return current;
  const fullest = names.filter(
    (name) => !names.some((other) => other !== name && other.includes(name)),
  );
  return fullest.length ? fullest.join('; ').replace(/^[; ]+|[; ]+$/g, '') : current;
}

export function checkAuthors(authors: string, blacklist: ReadonlySet<string>): string | undefined {
  const denied = new Set(Array.from(blacklist, (name) => name.toLowerCase()));
  const kept = authors
    .split(';')
    .map(pythonStrip)
    .filter((name) => name && !denied.has(name.toLowerCase()));
  return kept.length ? kept.join('; ').replace(/^[; ]+|[; ]+$/g, '') : undefined;
}
