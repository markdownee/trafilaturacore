// SPDX-License-Identifier: Apache-2.0
//
// trafilaturacore — a pure-TypeScript content-extraction library.
// HTML in → cleaned HTML out (+ metadata sidecar).
//
// The public entry point is the async clean() (src/pipeline.ts), composing:
//   - the ported extraction core (src/core/) — Trafilatura-derived boilerplate
//     removal, emitting upstream-aligned, UNSANITIZED HTML;
//   - the TypeScript cleaning stage (src/cleaning/, driven by the single
//     Trafilatura-aligned DEFAULT_CLEAN_CONFIG) — the sole sanitization
//     authority over that output;
//   - the TypeScript metadata sidecar (src/metadata/).

export { formatSecuredHtml } from './cleaning/presentation.js';
export { clean, prepare } from './pipeline.js';
export * from './types.js';

/**
 * Package version for library consumers.
 */
export const VERSION = '0.8.0';
