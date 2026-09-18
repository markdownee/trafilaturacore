// SPDX-License-Identifier: Apache-2.0
//
// Public type surface for trafilaturacore.
//
// The knobs (boilerplate-removal mode + optional custom cleaning config) are
// plain string-union / `as const`-array types, NOT TypeScript `enum`s (locked
// decision #4 in the build brief). Cleaning uses the single Trafilatura-aligned
// `DEFAULT_CLEAN_CONFIG`; callers may instead pass a fully-custom `CleanConfig`
// (pure JSON data — see {@link CleanOptions.config}).

import type { CleanConfig } from './cleaning/config.js';

export type { CleanConfig } from './cleaning/config.js';
export { DEFAULT_CLEAN_CONFIG } from './cleaning/config.js';

/**
 * Boilerplate-removal mode — gates the Trafilatura-derived main-content extraction.
 *
 * - `precision` → sets `favor_precision` (less noise, may miss content)
 * - `balanced`  → neither flag (neutral default)
 * - `recall`    → sets `favor_recall` (more content, may include noise)
 * - `keep`      → skip boilerplate removal entirely: HTML cleanup only, keeping the
 *   whole document after the tokenizer's validation-only resource preflight
 *
 * All four modes clean; `precision`/`balanced`/`recall` mirror Trafilatura's
 * internal focus. `keep` is trafilaturacore's addition (upstream has no such mode)
 * — it does the cleanup without boilerplate removal / main-content extraction, so
 * the boilerplate is kept.
 */
export const Boilerplate = {
  Precision: 'precision',
  Balanced: 'balanced',
  Recall: 'recall',
  Keep: 'keep',
} as const;
export type Boilerplate = (typeof Boilerplate)[keyof typeof Boilerplate];
export type BoilerplateMode = Boilerplate;
export const BOILERPLATE_MODES = [
  Boilerplate.Precision,
  Boilerplate.Balanced,
  Boilerplate.Recall,
  Boilerplate.Keep,
] as const;
export const DEFAULT_BOILERPLATE_MODE = Boilerplate.Balanced;

/**
 * Image handling — what becomes of each image structure
 * (`img`/`figure`/`figcaption`/`picture`/`source`) in the cleaned output.
 *
 * - `include` → images pass through the normal cleaning path untouched
 * - `exclude` → discard image subtrees entirely (including their text, e.g. a
 *   `figcaption` dies with its `figure`)
 * - `alt-text` → replace each image with a src-less `<img alt="…">` stand-in;
 *   the alt text falls back through `alt` → `figcaption` → `aria-label` →
 *   `aria-labelledby` → `title`; an explicit `alt=""` marks a decorative image,
 *   which is removed entirely
 * - `resolved-url` → normalize each image structure to ONE clean `<img>` whose
 *   `src` is the resolved absolute image URL (lazy-load `data-src` promotion,
 *   largest `srcset` candidate, absolutized against {@link CleanOptions.url}
 *   falling back to the raw document's `<base href>`); `<picture>` is unwrapped
 *   to its `<img>` and `<source>` dropped
 */
export const ImageHandling = {
  Include: 'include',
  Exclude: 'exclude',
  AltText: 'alt-text',
  ResolvedUrl: 'resolved-url',
} as const;
export type ImageHandling = (typeof ImageHandling)[keyof typeof ImageHandling];
export type ImageHandlingMode = ImageHandling;
export const IMAGE_HANDLING_MODES = [
  ImageHandling.Include,
  ImageHandling.Exclude,
  ImageHandling.AltText,
  ImageHandling.ResolvedUrl,
] as const;
export const DEFAULT_IMAGE_HANDLING_MODE = ImageHandling.Include;

/**
 * Link handling. `exclude` UNWRAPS `<a>` — the anchor text survives, the `href`
 * is dropped (never a subtree discard).
 */
export const LinkHandling = {
  Include: 'include',
  Exclude: 'exclude',
} as const;
export type LinkHandling = (typeof LinkHandling)[keyof typeof LinkHandling];
export type LinkHandlingMode = LinkHandling;
export const LINK_HANDLING_MODES = [LinkHandling.Include, LinkHandling.Exclude] as const;
export const DEFAULT_LINK_HANDLING_MODE = LinkHandling.Include;

/**
 * Table handling. `exclude` discards table subtrees
 * (`table`/`caption`/`tr`/`td`/`th`/`colgroup`/`col`, including cell text).
 */
export const TableHandling = {
  Include: 'include',
  Exclude: 'exclude',
} as const;
export type TableHandling = (typeof TableHandling)[keyof typeof TableHandling];
export type TableHandlingMode = TableHandling;
export const TABLE_HANDLING_MODES = [TableHandling.Include, TableHandling.Exclude] as const;
export const DEFAULT_TABLE_HANDLING_MODE = TableHandling.Include;

/**
 * Comment handling — user-comment sections (forum/blog comments), NOT `<!-- -->`
 * markup. `exclude` removes detected user-comment containers after extraction
 * and before sanitization/presentation.
 */
export const CommentHandling = {
  Include: 'include',
  Exclude: 'exclude',
} as const;
export type CommentHandling = (typeof CommentHandling)[keyof typeof CommentHandling];
export type CommentHandlingMode = CommentHandling;
export const COMMENT_HANDLING_MODES = [CommentHandling.Include, CommentHandling.Exclude] as const;
export const DEFAULT_COMMENT_HANDLING_MODE = CommentHandling.Include;

/**
 * Default upper bound on `clean()` input size, measured in UTF-8 bytes (10 MB).
 * Inputs larger than {@link CleanOptions.maxInputBytes} (defaulting to this) are
 * rejected at the boundary with a `RangeError` rather than processed — a
 * resource bound per the security guideline ("bound resource use; validate
 * input at every boundary").
 */
export const DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024;

/** Severity of a pipeline diagnostic message. */
export type MessageType = 'info' | 'warning' | 'error';

/** A non-fatal diagnostic accumulated while running the pipeline. */
export interface Message {
  type: MessageType;
  text: string;
}

/**
 * Optional metadata sidecar returned alongside the cleaned HTML. It never
 * replaces or converts the HTML content — it is purely additive context.
 */
export interface Metadata {
  title?: string;
  author?: string;
  url?: string;
  hostname?: string;
  description?: string;
  sitename?: string;
  /** ISO-8601 date string when resolvable. */
  date?: string;
  categories?: string[];
  tags?: string[];
  image?: string;
  /**
   * The page type the page DECLARES about itself: raw OpenGraph `og:type`, or an
   * upstream-recognized, lowercased JSON-LD `@type` when OpenGraph did not fill
   * the canonical Trafilatura `Document.pagetype`. It remains descriptive string
   * metadata, never a classifier verdict and never an extraction input.
   */
  declaredPageType?: string;
  license?: string;
}

/**
 * Options for {@link clean}. The `boilerplate` mode + the cleaning `config` are the
 * core knobs; the four `*Handling` mode enums below control what becomes of each
 * content family. The Trafilatura-aligned `DEFAULT_CLEAN_CONFIG` (or a
 * fully-custom `config`) is the baseline tag-inclusion control; each
 * `*Handling: 'exclude'` subtracts a content family on top of it (see
 * {@link deriveContentConfig}), while `imageHandling: 'alt-text' | 'resolved-url'`
 * runs the pre-sanitize image pass in the cleaning stage.
 */
export interface CleanOptions {
  /** Boilerplate-removal mode. Default `'balanced'`. */
  boilerplate?: BoilerplateMode;
  /**
   * Comment handling (user-comment sections). Default `'include'`. `'exclude'`
   * removes detected comment containers before sanitization and presentation.
   */
  commentHandling?: CommentHandlingMode;
  /**
   * Table handling. Default `'include'`. `'exclude'` discards table subtrees
   * (`table`/`caption`/`tr`/`td`/`th`/`colgroup`/`col`, including cell text).
   */
  tableHandling?: TableHandlingMode;
  /**
   * Image handling. Default `'include'`. `'exclude'` discards image subtrees
   * (`img`/`figure`/`figcaption`/`picture`/`source`, including their text).
   * `'alt-text'` replaces each image with a src-less `<img alt="…">` stand-in
   * (fallback chain `alt` → `figcaption` → `aria-label` → `aria-labelledby` →
   * `title`; explicit `alt=""` = decorative → the image is removed; never the
   * filename). `'resolved-url'` normalizes each image structure to one clean
   * `<img>` whose `src` is the resolved absolute URL — lazy-load `data-src`
   * promotion, largest `srcset` candidate, absolutized against
   * {@link CleanOptions.url} falling back to the raw document's `<base href>`
   * (with no base at all, absolute URLs are still normalized, relative ones are
   * left as authored and a warning message is pushed).
   */
  imageHandling?: ImageHandlingMode;
  /**
   * Link handling. Default `'include'`. `'exclude'` unwraps `<a>` (anchor text kept,
   * `href` dropped).
   */
  linkHandling?: LinkHandlingMode;
  /**
   * Fully-custom cleaning config — a {@link CleanConfig} (pure JSON data). When
   * set it drives the sanitize stage directly, replacing the default
   * Trafilatura-aligned `DEFAULT_CLEAN_CONFIG`. The security floor still applies
   * (`<script>` and `on*` are always stripped; a config that allows inline
   * `style` still gets the CSS-URL allow-list). Validated at the boundary — see
   * {@link isCleanConfig}.
   */
  config?: CleanConfig;
  /**
   * Upper bound on the input HTML size, measured in UTF-8 bytes. Defaults to
   * {@link DEFAULT_MAX_INPUT_BYTES} (10 MB). Inputs whose UTF-8 byte length
   * exceeds this are rejected at the boundary with a `RangeError` rather than
   * processed — a resource bound (validate input at every boundary). When
   * provided, the value must be a positive safe integer; `NaN`, infinities,
   * fractions, zero, and negative values are rejected. Set a larger finite
   * value to opt into processing bigger documents.
   */
  maxInputBytes?: number;
  /**
   * Optional source URL — context only, for the metadata `url`/`hostname` and as
   * the absolutization base for `imageHandling: 'resolved-url'`. trafilaturacore
   * NEVER fetches it. This is not a content-inclusion toggle.
   */
  url?: string;
}

/** Result of {@link clean}: cleaned HTML, diagnostics, and an optional metadata sidecar. */
export interface CleanResult {
  html: string;
  messages: Message[];
  metadata?: Metadata;
}

/** Secured post-cleaning HTML before the compact presentation pass. */
export type PreparedCleanResult = CleanResult;

/** Reimplemented first-party validators for the retained public contract above. */
export function isBoilerplateMode(value: unknown): value is BoilerplateMode {
  return BOILERPLATE_MODES.some((mode) => mode === value);
}

const CLEAN_CONFIG_KEYS = [
  'allowedTags',
  'allowedAttributes',
  'allowedClasses',
  'selfClosing',
  'nonTextTags',
  'transformTags',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

function arrayMap(value: unknown): boolean {
  return record(value) && Object.values(value).every(strings);
}

function stringMap(value: unknown): boolean {
  return record(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

const CONFIG_VALIDATORS: ReadonlyArray<
  readonly [keyof CleanConfig, (value: unknown) => boolean, string]
> = [
  ['allowedTags', strings, 'must be an array of strings'],
  ['selfClosing', strings, 'must be an array of strings'],
  ['nonTextTags', strings, 'must be an array of strings'],
  ['allowedAttributes', arrayMap, 'must map tag names to arrays of strings'],
  ['allowedClasses', arrayMap, 'must map tag names to arrays of strings'],
  ['transformTags', stringMap, 'must map tag names to tag-name strings'],
];

export function cleanConfigError(value: unknown): string | null {
  if (!record(value)) return 'expected a JSON object';
  for (const field of Object.keys(value)) {
    if (!CLEAN_CONFIG_KEYS.some((allowed) => allowed === field)) {
      return `unknown field '${field}' (allowed: ${CLEAN_CONFIG_KEYS.join(', ')})`;
    }
  }
  for (const [field, accepts, message] of CONFIG_VALIDATORS) {
    if (value[field] !== undefined && !accepts(value[field])) return `'${field}' ${message}`;
  }
  return null;
}

export function isCleanConfig(value: unknown): value is CleanConfig {
  return cleanConfigError(value) === null;
}
