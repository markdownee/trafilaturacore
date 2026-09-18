// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/core.py
// _forum_thread_page, _prepare_tree, _recall_retry, trafilatura_sequence,
// and bare_extraction's minimum-output check.
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/core.py#L137-L287
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/core.py#L452-L462
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: freshly expressed against the product tree API; only fast=True stages are
// included. Diagnostics, bounded substring work and the linear declaration scanner are
// first-party adaptations. The old Rust/TypeScript implementation is comparison evidence.

import { baseline, html2txt } from './baseline.js';
import { convertTags, pruneUnwantedNodes, treeCleaning } from './htmlprocessing.js';
import { elemText, extractComments, extractContent } from './main-extractor.js';
import type { Options } from './options.js';
import { REMOVE_COMMENTS_RULES } from './selectors.js';
import {
  ESCALATION_ACCEPT_RATIO,
  ESCALATION_MAX_LENGTH,
  ESCALATION_PAGE_SHARE,
  FORUM_SALVAGE_SCAN_BYTES,
  MIN_EXTRACTED_SIZE,
  MIN_OUTPUT_COMM_SIZE,
  MIN_OUTPUT_SIZE,
} from './settings.js';
import { charCount, type NodeId, type Tree } from './tree.js';
import { PY_SPACE_CLASS, stripPySpace } from './utils.js';

/** One complete fast-path extraction, before sanitization. */
export interface Sequence {
  postbody: NodeId;
  tempText: string;
  lenText: number;
  commentsbody: NodeId;
  lenComments: number;
  fallbackUsed: boolean;
  warnings: string[];
}

/**
 * Recognize the pinned declaration grammar without restarting an unbounded array scan.
 * This is a first-party implementation of core.py::_DISCUSSION_FORUM_POSTING_RE.
 * Both lookahead cursors move forward only; absent delimiters are represented by infinity.
 */
function hasForumDeclaration(source: string): boolean {
  const literal = '"DiscussionForumPosting"';
  if (!source.includes(literal)) return false;
  const keys = new RegExp(`"@type"[${PY_SPACE_CLASS}]*:[${PY_SPACE_CLASS}]*`, 'g');
  let close = 0;
  let value = 0;
  for (const match of source.matchAll(keys)) {
    const start = match.index + match[0].length;
    if (source.startsWith(literal, start)) return true;
    if (source[start] !== '[') continue;
    if (close <= start) {
      const position = source.indexOf(']', start + 1);
      close = position < 0 ? Infinity : position;
    }
    if (value <= start) {
      const position = source.indexOf(literal, start + 1);
      value = position < 0 ? Infinity : position;
    }
    if (value < close) return true;
  }
  return false;
}

/** Python core.py::_forum_thread_page; no metadata-sidecar classification is consulted. */
function isForum(tree: Tree, root: NodeId): boolean {
  return tree.anyDescendant(
    root,
    (node) =>
      tree.tag(node) === 'script' &&
      tree.get(node, 'type') === 'application/ld+json' &&
      hasForumDeclaration(tree.text(node) ?? ''),
  );
}

/** Python core.py::_prepare_tree, preserving the pre-conversion backup. */
function prepared(tree: Tree, root: NodeId, options: Options): readonly [NodeId, NodeId] {
  const cleaned = treeCleaning(tree, tree.deepCopy(root), options);
  const backup = tree.deepCopy(cleaned);
  return [convertTags(tree, cleaned, options, options.url), backup];
}

/**
 * Select missing captured posts. Python's substring test is retained within the
 * product work allowance; beyond it, ambiguous posts are retained rather than lost.
 * Exact child-text membership remains available after the allowance is exhausted.
 */
function missingForumPosts(
  tree: Tree,
  body: NodeId,
  comments: NodeId,
  substringScanBudget: number,
): NodeId[] {
  const paragraphs = tree
    .children(body)
    .map((node) => elemText(tree, node))
    .filter(Boolean);
  const exact = new Set(paragraphs);
  const whole = paragraphs.join('\n');
  const selected: NodeId[] = [];
  let remaining = substringScanBudget;
  for (const node of tree.children(comments)) {
    const text = elemText(tree, node);
    if (!text || exact.has(text)) continue;
    if (text.length > whole.length) {
      selected.push(node);
      continue;
    }
    const cost = text.length + whole.length;
    if (cost > remaining) {
      remaining = 0;
      selected.push(node);
    } else {
      remaining -= cost;
      if (!whole.includes(text)) selected.push(node);
    }
  }
  return selected;
}

/** Python core.py::trafilatura_sequence restricted to fast=True. */
export function trafilaturaSequence(tree: Tree, root: NodeId, options: Options): Sequence {
  const forum = isForum(tree, root);
  const prune = (node: NodeId): NodeId =>
    pruneUnwantedNodes(tree, tree.deepCopy(node), REMOVE_COMMENTS_RULES, false);
  const input =
    !options.include_comments && (options.focus === 'precision' || !forum) ? prune(root) : root;
  const [converted, backup] = prepared(tree, input, options);
  let working = converted;
  let comments = { body: tree.create('body'), length: 0 };
  let savedPosts: NodeId | undefined;

  if (options.include_comments) {
    const found = extractComments(tree, working, options);
    comments = { body: found.body, length: found.length };
    if (forum && found.length > 0) {
      savedPosts = found.body;
      comments = { body: tree.create('body'), length: 0 };
      working = convertTags(tree, tree.deepCopy(backup), options, options.url);
    }
  }
  if (options.focus === 'precision' && !forum) {
    working = pruneUnwantedNodes(tree, working, REMOVE_COMMENTS_RULES, false);
  }

  let selected = extractContent(tree, working, options);
  const warnings: string[] = [];
  let fallbackUsed = false;
  if (selected.length < MIN_EXTRACTED_SIZE && options.focus !== 'precision') {
    selected = baseline(tree, input);
    savedPosts = undefined;
    fallbackUsed = true;
    warnings.push('baseline-rescue');
  }

  if (
    options.focus === 'balanced' &&
    selected.length > 0 &&
    selected.length < ESCALATION_MAX_LENGTH &&
    selected.length < ESCALATION_PAGE_SHARE * charCount(html2txt(tree, input, true))
  ) {
    const recall: Options = { ...options, focus: 'recall' };
    const [candidateRoot] = prepared(tree, forum ? input : prune(input), recall);
    const candidate = extractContent(tree, candidateRoot, recall);
    if (
      candidate.length >= MIN_EXTRACTED_SIZE &&
      candidate.length > ESCALATION_ACCEPT_RATIO * selected.length
    ) {
      selected = candidate;
      savedPosts = undefined;
      fallbackUsed = true;
      warnings.push('recall-escalation');
    }
  }

  if (savedPosts !== undefined) {
    const missing = missingForumPosts(tree, selected.body, savedPosts, FORUM_SALVAGE_SCAN_BYTES);
    if (missing.length > 0) {
      tree.extend(selected.body, missing);
      const text = stripPySpace(tree.itertextParts(selected.body).join(' '));
      selected = { body: selected.body, text, length: charCount(text) };
      warnings.push('thread-forum-salvage');
    }
  }
  return {
    postbody: selected.body,
    tempText: selected.text,
    lenText: selected.length,
    commentsbody: comments.body,
    lenComments: comments.length,
    fallbackUsed,
    warnings,
  };
}

/** Python core.py::bare_extraction's independent body and comment minimums. */
export function passesOutputSize(bodyLength: number, commentLength: number): boolean {
  return !(bodyLength < MIN_OUTPUT_SIZE && commentLength < MIN_OUTPUT_COMM_SIZE);
}

export { missingForumPosts as missingForumPostsForTests };
