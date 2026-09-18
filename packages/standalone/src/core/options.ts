// SPDX-License-Identifier: Apache-2.0
// Modified in part from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/settings.py (Extractor)
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/settings.py#L125-L160
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: freshly declared product options for the offline fast path. All content
// families default on so later cleaning controls their presentation. Runtime validation
// and the reduced public vocabulary are first-party product contracts.

import { ExtractionError } from './error.js';

export const FOCUS_MODES = ['precision', 'balanced', 'recall'] as const;
export type Focus = (typeof FOCUS_MODES)[number];

/** Native core options use the upstream include-switch vocabulary. */
export interface Options {
  focus: Focus;
  url?: string | undefined;
  include_links: boolean;
  include_images: boolean;
  include_tables: boolean;
  include_comments: boolean;
  include_formatting: boolean;
}

/** Interpret the product focus without accepting another extraction profile. */
export function focusFromString(value: string): Focus {
  const focus = value.toLowerCase();
  switch (focus) {
    case 'precision':
    case 'balanced':
    case 'recall':
      return focus;
    default:
      throw ExtractionError.invalidOption(`focus: ${focus}`);
  }
}

export function defaultOptions(): Options {
  return {
    include_comments: true,
    include_formatting: true,
    include_images: true,
    include_links: true,
    include_tables: true,
    focus: 'balanced',
    url: undefined,
  };
}

export function favorPrecision(options: Options): boolean {
  return options.focus === 'precision';
}

export function favorRecall(options: Options): boolean {
  return options.focus === 'recall';
}
