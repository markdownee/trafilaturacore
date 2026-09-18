// SPDX-License-Identifier: Apache-2.0
// First-party boundary schema; upstream-derived HTML remains unsanitized at this boundary.

/** Extraction output consumed by the product's mandatory cleaning stage. */
export interface CoreExtractResult {
  content_html: string;
  comments_html: string;
  /** Selected Unicode scalar-value count, not serialized HTML length. */
  text_length: number;
  fallback_used: boolean;
  warnings: string[];
}

/** Construct an independent empty result without shared mutable diagnostic storage. */
export function emptyExtractResult(): CoreExtractResult {
  return {
    warnings: [],
    fallback_used: false,
    text_length: 0,
    comments_html: '',
    content_html: '',
  };
}
