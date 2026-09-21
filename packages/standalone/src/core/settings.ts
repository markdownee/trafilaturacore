// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/settings.py, trafilatura/settings.cfg, trafilatura/core.py, trafilatura/baseline.py, trafilatura/htmlprocessing.py, trafilatura/main_extractor.py
// https://github.com/adbar/trafilatura/tree/c1bc9531a2a978326112ca9987e1382745116136/trafilatura
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: offline extraction constants transcribed directly from pinned Python ASTs.
// Set-valued sources are sorted for deterministic emission. Network, external-extractor,
// language and caller-enabled deduplication settings are omitted. Product limits below
// are first-party contract data, separate from the upstream extraction heuristics.

/** Python settings.py::TAG_CATALOG. */
export const TAG_CATALOG: readonly string[] = [
  'blockquote',
  'code',
  'del',
  'head',
  'hi',
  'lb',
  'list',
  'p',
  'pre',
  'quote',
];

/** Python settings.py::CUT_EMPTY_ELEMS. */
export const CUT_EMPTY_ELEMS: ReadonlySet<string> = new Set([
  'article',
  'b',
  'blockquote',
  'dd',
  'div',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'main',
  'p',
  'pre',
  'q',
  'section',
  'span',
  'strong',
]);

/** Python settings.py::MANUALLY_CLEANED. */
export const MANUALLY_CLEANED: readonly string[] = [
  'aside',
  'embed',
  'fencedframe',
  'footer',
  'form',
  'head',
  'iframe',
  'menu',
  'object',
  'script',
  'applet',
  'audio',
  'canvas',
  'figure',
  'map',
  'picture',
  'svg',
  'video',
  'area',
  'blink',
  'button',
  'datalist',
  'dialog',
  'frame',
  'frameset',
  'fieldset',
  'link',
  'input',
  'ins',
  'label',
  'legend',
  'marquee',
  'math',
  'menuitem',
  'nav',
  'noindex',
  'noscript',
  'optgroup',
  'option',
  'output',
  'param',
  'progress',
  'rp',
  'rt',
  'rtc',
  'select',
  'source',
  'style',
  'track',
  'textarea',
  'time',
  'use',
];

/** Python settings.py::MANUALLY_STRIPPED. */
export const MANUALLY_STRIPPED: readonly string[] = [
  'abbr',
  'acronym',
  'address',
  'bdi',
  'bdo',
  'big',
  'cite',
  'data',
  'dfn',
  'font',
  'hgroup',
  'img',
  'ins',
  'mark',
  'meta',
  'nobr',
  'ruby',
  'small',
  'tbody',
  'template',
  'tfoot',
  'thead',
];

/** Python settings.py::INLINE_CONSUMING. */
export const INLINE_CONSUMING: readonly string[] = ['del', 'hi', 'ref'];

/** Python settings.py::INLINE_FORMATTABLE. */
export const INLINE_FORMATTABLE: readonly string[] = ['code', 'del', 'hi', 'ref'];

/** Python settings.py::INLINE_CARRIED. */
export const INLINE_CARRIED: ReadonlySet<string> = new Set(['code', 'del', 'graphic', 'hi', 'ref']);

/** Python settings.py::MIN_DUPLICATE_LENGTH. */
export const MIN_DUPLICATE_LENGTH = 50;

/** Python settings.py::DEDUPE_SCAN_CAP. */
export const DEDUPE_SCAN_CAP = 200000;

/** Python settings.py::_COOKIE_CONSENT_RE. */
export const COOKIE_CONSENT_RE =
  'cookie[-_]?(?:banner|bar|consent|law|notice|policy|description)|notice[-_]{0,2}cookie|consent[-_]?(?:banner|manager|sdk)|borlabs|cookiebot|cmplz|onetrust|moove[-_]?gdpr';

/** Python core.py::ESCALATION_MAX_LENGTH. */
export const ESCALATION_MAX_LENGTH = 3000;

/** Python core.py::ESCALATION_PAGE_SHARE. */
export const ESCALATION_PAGE_SHARE = 0.2;

/** Python core.py::ESCALATION_ACCEPT_RATIO. */
export const ESCALATION_ACCEPT_RATIO = 1.5;

/** Python baseline.py::_BLOCK_ELEMS. */
export const BLOCK_ELEMS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

/** Python baseline.py::_MIN_CONTENT_LENGTH. */
export const MIN_CONTENT_LENGTH = 100;

/** Python main_extractor.py::_MAX_SPAN. */
export const MAX_SPAN = 100;

/** Python htmlprocessing.py::PRESERVE_IMG_CLEANING. */
export const PRESERVE_IMG_CLEANING: readonly string[] = ['figure', 'picture', 'source'];

/** Python settings.cfg::MIN_EXTRACTED_SIZE. */
export const MIN_EXTRACTED_SIZE = 250;

/** Python settings.cfg::MIN_EXTRACTED_COMM_SIZE. */
export const MIN_EXTRACTED_COMM_SIZE = 1;

/** Python settings.cfg::MIN_OUTPUT_SIZE. */
export const MIN_OUTPUT_SIZE = 1;

/** Python settings.cfg::MIN_OUTPUT_COMM_SIZE. */
export const MIN_OUTPUT_COMM_SIZE = 1;

// First-party limits retained from the established product resource contract.
/** Maximum parsed nesting depth. */
export const MAX_TREE_DEPTH = 512;

/** Non-optional extraction input ceiling in UTF-8 bytes. */
export const MAX_INPUT_BYTES = 32 * 1024 * 1024;

/** Maximum preflight nodes; depth is guarded independently. */
export const MAX_SOURCE_NODES = 262_144;

/** Bounds parse5 duplicate-attribute scans before token allocation. */
export const MAX_ATTRIBUTES_PER_TAG = 1_024;

/** Cumulative n*(n-1)/2 source-attribute scan allowance. */
export const MAX_ATTRIBUTE_SCAN_COMPARISONS = 10_000_000;

/** Source nodes plus extraction copies share one allowance. */
export const MAX_ARENA_NODES = 1_048_576;

/** Cumulative UTF-8 bytes admitted into arena strings, including replacement writes. */
export const MAX_ARENA_STRING_BYTES = 64 * 1024 * 1024;

/** Combined serialized body and comment byte ceiling. */
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Maximum rebuilt cells, shared across all input tables. */
export const TABLE_CELL_BUDGET = 65_536;

/** Cumulative child visits during tag stripping. */
export const MAX_STRIP_VISITS = 64 * MAX_SOURCE_NODES;

/** Optional substring-scan allowance; ambiguous posts survive exhaustion. */
export const FORUM_SALVAGE_SCAN_BYTES = 16 * 1024 * 1024;

/** Metadata author truncation ceiling. */
export const MAX_AUTHOR_NAMES = 250;

/** Malformed JSON author fallback cumulative UTF-16 scan allowance. */
export const MAX_JSON_AUTHOR_RESCAN_UNITS = 4 * 1024 * 1024;

/** Malformed JSON author fallback UTF-16 input ceiling. */
export const MAX_JSON_AUTHOR_FALLBACK_UNITS = 65_536;
