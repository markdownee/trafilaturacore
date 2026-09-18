// SPDX-License-Identifier: Apache-2.0
// Offline supplied-HTML pipeline.
// Core validation/extraction must finish before any metadata or cleaning DOM.
// Resource failures reject; ordinary extraction failures retain whole-document
// cleaning. The metadata sidecar never selects the extraction strategy.

import { prepareHtml } from './cleaning/clean.js';
import { DEFAULT_CLEAN_CONFIG, deriveContentConfig } from './cleaning/config.js';
import { readBaseHref } from './cleaning/images.js';
import { formatSecuredHtml } from './cleaning/presentation.js';
import { extract, validate } from './core/binding.js';
import { extractMetadata } from './metadata/index.js';
import {
  type CleanOptions,
  type CleanResult,
  COMMENT_HANDLING_MODES,
  cleanConfigError,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_MAX_INPUT_BYTES,
  IMAGE_HANDLING_MODES,
  isBoilerplateMode,
  LINK_HANDLING_MODES,
  type Message,
  type Metadata,
  type PreparedCleanResult,
  TABLE_HANDLING_MODES,
} from './types.js';

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resourceFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = 'ERR_TRAFILATURACORE_RESOURCE_LIMIT';
  return (
    ('code' in error && error.code === code) ||
    ('message' in error && typeof error.message === 'string' && error.message.includes(`${code}:`))
  );
}

function checkInput(html: string, options: CleanOptions): void {
  if (options.config !== undefined) {
    const reason = cleanConfigError(options.config);
    if (reason !== null) throw new TypeError(`Invalid cleaning config: ${reason}`);
  }
  if (typeof html !== 'string') {
    throw new TypeError(`clean() expects \`html\` to be a string, received ${typeof html}`);
  }
  if (options.boilerplate !== undefined && !isBoilerplateMode(options.boilerplate)) {
    throw new TypeError(`Invalid boilerplate mode: ${String(options.boilerplate)}`);
  }
  const choices = [
    ['commentHandling', COMMENT_HANDLING_MODES],
    ['tableHandling', TABLE_HANDLING_MODES],
    ['imageHandling', IMAGE_HANDLING_MODES],
    ['linkHandling', LINK_HANDLING_MODES],
  ] as const;
  for (const [field, allowed] of choices) {
    const actual = options[field];
    if (actual !== undefined && !allowed.some((value) => value === actual)) {
      throw new TypeError(`Invalid ${field}: '${String(actual)}' (valid: ${allowed.join(', ')})`);
    }
  }
  const ceiling = options.maxInputBytes;
  if (ceiling !== undefined && typeof ceiling !== 'number') {
    throw new TypeError(
      `Invalid maxInputBytes: expected a positive safe integer, received ${typeof ceiling}`,
    );
  }
  const limit = ceiling ?? DEFAULT_MAX_INPUT_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError(
      `Invalid maxInputBytes: expected a positive safe integer, received ${String(limit)}`,
    );
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > limit)
    throw new RangeError(`Input HTML is ${bytes} bytes, exceeding the limit of ${limit} bytes`);
}

async function content(html: string, options: CleanOptions, messages: Message[]): Promise<string> {
  const focus = options.boilerplate ?? DEFAULT_BOILERPLATE_MODE;
  if (focus === 'keep') {
    await validate(html);
    return html;
  }
  try {
    const result = await extract(html, {
      focus,
      url: options.url,
      includeComments: options.commentHandling !== 'exclude',
    });
    for (const warning of result.warnings)
      messages.push({ type: 'warning', text: `boilerplate: ${warning}` });
    const selected =
      result.contentHtml + (options.commentHandling === 'exclude' ? '' : result.commentsHtml);
    if (selected) return selected;
    messages.push({
      type: 'warning',
      text: 'boilerplate removal produced no content; cleaning the whole document',
    });
  } catch (error) {
    if (resourceFailure(error)) throw error;
    messages.push({
      type: 'warning',
      text: `boilerplate removal failed: ${detail(error)}; cleaning the whole document`,
    });
  }
  return html;
}

/** One validation, extraction and sanitization pass, without HTML presentation. */
export async function prepare(
  html: string,
  options: CleanOptions = {},
): Promise<PreparedCleanResult> {
  checkInput(html, options);
  const extractionMessages: Message[] = [];
  const selected = await content(html, options, extractionMessages);
  const messages: Message[] = [];
  let metadata: Metadata | undefined;
  try {
    const extracted = extractMetadata(html, options.url);
    if (Object.keys(extracted).length) metadata = extracted;
  } catch (error) {
    messages.push({ type: 'warning', text: `metadata extraction failed: ${detail(error)}` });
  }
  messages.push(...extractionMessages);
  const base = options.config ?? DEFAULT_CLEAN_CONFIG;
  const effective = deriveContentConfig(base, {
    tableHandling: options.tableHandling,
    imageHandling: options.imageHandling,
    linkHandling: options.linkHandling,
  });
  const cleaned = await prepareHtml(selected, {
    config: effective === base ? options.config : effective,
    imageHandling: options.imageHandling,
    commentHandling: options.commentHandling,
    url: options.url,
    baseHref:
      options.imageHandling === 'resolved-url' && options.url === undefined
        ? readBaseHref(html)
        : undefined,
  });
  messages.push(...cleaned.messages);
  const result: PreparedCleanResult = { html: cleaned.html, messages };
  if (metadata) result.metadata = metadata;
  return result;
}

/** Compact presentation of the already secured preparation result. */
export async function clean(html: string, options: CleanOptions = {}): Promise<CleanResult> {
  const prepared = await prepare(html, options);
  const formatted = await formatSecuredHtml(prepared.html);
  return {
    ...prepared,
    html: formatted.html,
    messages: prepared.messages.concat(formatted.messages),
  };
}
