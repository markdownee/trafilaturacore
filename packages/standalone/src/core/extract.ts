// SPDX-License-Identifier: Apache-2.0
// First-party offline orchestration and resource enforcement. The algorithms called here
// carry their own pinned upstream provenance. This boundary is not an upstream translation.

import { passesOutputSize, type Sequence, trafilaturaSequence } from './core.js';
import { parseDocument, preflightDocument } from './dom.js';
import { ExtractionError } from './error.js';
import { convertToHtml, OutputBudget, serializeFragmentBounded } from './html-output.js';
import type { Options } from './options.js';
import { type CoreExtractResult, emptyExtractResult } from './result.js';
import { MAX_INPUT_BYTES } from './settings.js';
import type { NodeId, Tree } from './tree.js';

/** Refuse oversize input before tokenization or DOM construction. */
function checkInput(html: string): void {
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_INPUT_BYTES) {
    throw ExtractionError.resourceLimit('input-bytes', MAX_INPUT_BYTES, bytes);
  }
}

/** Propagate the first recorded tree resource failure rather than entering a fallback. */
function checkTree(tree: Tree): void {
  const error = tree.resourceError();
  if (error) throw error;
}

function select(html: string, options: Options): { tree: Tree; sequence: Sequence } {
  checkInput(html);
  const parsed = parseDocument(html);
  const sequence = trafilaturaSequence(parsed.tree, parsed.root, options);
  checkTree(parsed.tree);
  return { tree: parsed.tree, sequence };
}

function render(tree: Tree, root: NodeId, budget: OutputBudget): string {
  convertToHtml(tree, root);
  checkTree(tree);
  return serializeFragmentBounded(tree, root, budget);
}

/** Resource validation without a DOM, used by whole-document cleaning. */
export function validate(html: string): void {
  checkInput(html);
  preflightDocument(html);
}

/** Select and serialize supplied HTML. The result must still be sanitized by the caller. */
export function extract(html: string, options: Options): CoreExtractResult {
  const { tree, sequence } = select(html, options);
  if (!passesOutputSize(sequence.lenText, sequence.lenComments)) return emptyExtractResult();
  const budget = OutputBudget.production();
  const content = render(tree, sequence.postbody, budget);
  const comments = sequence.lenComments > 0 ? render(tree, sequence.commentsbody, budget) : '';
  return {
    content_html: content,
    comments_html: comments,
    text_length: sequence.lenText,
    fallback_used: sequence.fallbackUsed,
    warnings: sequence.warnings,
  };
}

/** Selected text for exact upstream comparisons, independent of HTML presentation. */
export function extractText(html: string, options: Options): string {
  const { sequence } = select(html, options);
  return passesOutputSize(sequence.lenText, sequence.lenComments) ? sequence.tempText : '';
}
