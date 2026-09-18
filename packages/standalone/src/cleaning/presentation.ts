// SPDX-License-Identifier: Apache-2.0
// First-party presentation adapter; input has already crossed the mandatory cleaning boundary.

import { minify } from 'html-minifier-terser';
import type { Message } from '../types.js';

export interface HtmlPresentationResult {
  html: string;
  messages: Message[];
}

/** Compact secured HTML once. A formatter failure preserves that secured representation. */
export async function formatSecuredHtml(securedHtml: string): Promise<HtmlPresentationResult> {
  const output: HtmlPresentationResult = { html: securedHtml, messages: [] };
  if (!securedHtml) return output;
  try {
    output.html = await minify(securedHtml, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      minifyCSS: true,
      minifyJS: true,
    });
  } catch {
    output.messages.push({
      type: 'warning',
      text: 'HTML formatting failed; secured unformatted HTML was returned.',
    });
  }
  return output;
}
