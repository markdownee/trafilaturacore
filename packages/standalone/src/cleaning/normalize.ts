// SPDX-License-Identifier: Apache-2.0
// First-party document/fragment normalization through the declared parse5 dependency.

import { parse, parseFragment, serialize } from 'parse5';
import type { Message } from '../types.js';

interface NormalizeHtmlResult {
  html: string | undefined;
  messages: Message[];
}

export function isHtmlDocument(html: string): boolean {
  return /<!doctype|<(?:html|head|body)[\s>]/i.test(html);
}

export function normalizeHtml(html: string, isFragment = true): NormalizeHtmlResult {
  if (!html?.trim()) return { html: '', messages: [] };
  try {
    const document = isFragment ? parseFragment(html) : parse(html);
    return { html: serialize(document), messages: [] };
  } catch (error) {
    return {
      html: undefined,
      messages: [
        {
          type: 'error',
          text:
            'HTML normalization failed: ' +
            (error instanceof Error ? error.message : 'Unknown parse5 error'),
        },
      ],
    };
  }
}
