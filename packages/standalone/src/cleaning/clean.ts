// SPDX-License-Identifier: Apache-2.0
// First-party cleaning orchestration. Normalization, image/comment transforms and configured
// sanitization always precede the unconditional active-content and CSS fixpoint passes.
// The core's resource preflight is the caller's required boundary before entering this stage.

import { type DefaultTreeAdapterTypes, parse, parseFragment, serialize } from 'parse5';
import type { CommentHandlingMode, ImageHandlingMode, Message } from '../types.js';
import { type Cleaner, cleanHtmlBackend, enforceSecurityFloor } from './cleaner.js';
import { excludeCommentSections } from './comment-sections.js';
import { type CleanConfig, DEFAULT_CLEAN_CONFIG } from './config.js';
import { cleanStyledHtml } from './css-cleaner.js';
import { decodeBuffer } from './decode.js';
import { applyImageHandling } from './images.js';
import { isHtmlDocument, normalizeHtml } from './normalize.js';
import { formatSecuredHtml } from './presentation.js';

interface CleanOptions {
  hardened?: boolean;
  config?: CleanConfig;
  imageHandling?: ImageHandlingMode;
  commentHandling?: CommentHandlingMode;
  url?: string;
  baseHref?: string;
}
interface CleanOutput {
  html: string;
  messages: Message[];
}

async function backend(hardened: boolean, messages: Message[]): Promise<Cleaner> {
  if (hardened) {
    try {
      const { createDompurifyBackend } = await import('./dompurify-backend.js');
      return await createDompurifyBackend();
    } catch (error) {
      messages.push({
        type: 'warning',
        text:
          'Hardened cleaner (dompurify + jsdom) unavailable, falling back to sanitize-html: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      });
    }
  }
  return cleanHtmlBackend;
}

/** Drop selected subtrees using fragment parsing when the input is a fragment. */
function drop(html: string, excluded: ReadonlySet<string>): string {
  const root = isHtmlDocument(html) ? parse(html) : parseFragment(html);
  const pending: DefaultTreeAdapterTypes.Node[] = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node === undefined) continue;
    if ('content' in node) pending.push((node as DefaultTreeAdapterTypes.Template).content);
    if (!('childNodes' in node)) continue;
    node.childNodes = node.childNodes.filter((child) => !excluded.has(child.nodeName));
    for (const child of node.childNodes) pending.push(child);
  }
  return serialize(root);
}

export function dropForeignContent(html: string): string {
  try {
    return enforceSecurityFloor(drop(html, new Set(['svg', 'math'])));
  } catch {
    return '';
  }
}
export function dropStyleElements(html: string): string {
  try {
    return enforceSecurityFloor(drop(html, new Set(['style'])));
  } catch {
    return '';
  }
}

function foreignFixpoint(html: string): string {
  let current = html;
  for (let round = 0; round < 3; round += 1) {
    const normalized = normalizeHtml(current, !isHtmlDocument(current));
    if (normalized.html === undefined) return '';
    const next = enforceSecurityFloor(normalized.html);
    if (next === current) return current;
    current = next;
  }
  return dropForeignContent(current);
}

function styledFixpoint(html: string): string {
  let current = cleanStyledHtml(html);
  if (current === html) return current;
  for (let round = 0; round < 3; round += 1) {
    const next = cleanStyledHtml(enforceSecurityFloor(current));
    if (next === current) return current;
    current = next;
  }
  return dropStyleElements(current);
}

export async function prepareHtml(html: string, options: CleanOptions = {}): Promise<CleanOutput> {
  const normalized = normalizeHtml(html, !isHtmlDocument(html));
  const messages = [...normalized.messages];
  if (!normalized.html) return { html: '', messages };
  let current = normalized.html;
  if (options.imageHandling === 'alt-text' || options.imageHandling === 'resolved-url') {
    const transformed = applyImageHandling(current, {
      mode: options.imageHandling,
      baseUrl: options.url ?? options.baseHref,
    });
    current = transformed.html;
    messages.push(...transformed.messages);
  }
  if (options.commentHandling === 'exclude') current = excludeCommentSections(current);
  const config = options.config ?? DEFAULT_CLEAN_CONFIG;
  const cleaner = await backend(options.hardened ?? false, messages);
  try {
    current = cleaner.clean(current, config);
  } catch (error) {
    messages.push({
      type: 'error',
      text:
        'HTML cleanup failed: ' +
        (error instanceof Error ? error.message : 'Unknown HTML cleanup error'),
    });
    return { html: '', messages };
  }
  if (config.transformTags !== undefined) {
    current = normalizeHtml(current, !isHtmlDocument(current)).html ?? current;
  }
  current = enforceSecurityFloor(current);
  if (/<(?:svg|math)\b/i.test(current)) current = foreignFixpoint(current);
  current = styledFixpoint(current);
  if (isHtmlDocument(current) && !current.trimStart().toLowerCase().startsWith('<!doctype')) {
    current = `<!DOCTYPE html>\n${current}`;
  }
  return { html: current, messages };
}

export async function cleanHtml(html: string, options: CleanOptions = {}): Promise<CleanOutput> {
  const prepared = await prepareHtml(html, options);
  const formatted = await formatSecuredHtml(prepared.html);
  return { html: formatted.html, messages: [...prepared.messages, ...formatted.messages] };
}

export async function cleanBuffer(
  buffer: Uint8Array,
  options: CleanOptions = {},
): Promise<CleanOutput> {
  const decoded = decodeBuffer(Buffer.from(buffer));
  if (decoded.html === undefined) return { html: '', messages: decoded.messages };
  const result = await cleanHtml(decoded.html, options);
  return { html: result.html, messages: [...decoded.messages, ...result.messages] };
}
