// SPDX-License-Identifier: Apache-2.0
// First-party in-process adapter for the established product/core boundary.
// Promise entry points run synchronously until return; they do not create a worker.

import { validate as preflight, extract as run } from './extract.js';
import { defaultOptions, focusFromString, type Options } from './options.js';

export interface ExtractOptions {
  focus?: 'precision' | 'balanced' | 'recall';
  url?: string | undefined;
  includeLinks?: boolean;
  includeImages?: boolean;
  includeTables?: boolean;
  includeComments?: boolean;
  includeFormatting?: boolean;
}

export interface ExtractResult {
  contentHtml: string;
  commentsHtml: string;
  textLength: number;
  fallbackUsed: boolean;
  warnings: string[];
}

function coreOptions(input: ExtractOptions): Options {
  const defaults = defaultOptions();
  return {
    focus: input.focus === undefined ? defaults.focus : focusFromString(input.focus),
    url: input.url,
    include_links: input.includeLinks === undefined ? defaults.include_links : input.includeLinks,
    include_images:
      input.includeImages === undefined ? defaults.include_images : input.includeImages,
    include_tables:
      input.includeTables === undefined ? defaults.include_tables : input.includeTables,
    include_comments:
      input.includeComments === undefined ? defaults.include_comments : input.includeComments,
    include_formatting:
      input.includeFormatting === undefined ? defaults.include_formatting : input.includeFormatting,
  };
}

/** Extract once in the calling thread; no fallback parse occurs at this seam. */
export function extractSync(html: string, options: ExtractOptions = {}): ExtractResult {
  const selected = run(html, coreOptions(options));
  return {
    contentHtml: selected.content_html,
    commentsHtml: selected.comments_html,
    textLength: selected.text_length,
    fallbackUsed: selected.fallback_used,
    warnings: selected.warnings,
  };
}

export function validateSync(html: string): void {
  preflight(html);
}

export async function extract(html: string, options?: ExtractOptions): Promise<ExtractResult> {
  return extractSync(html, options);
}

export async function validate(html: string): Promise<void> {
  validateSync(html);
}
