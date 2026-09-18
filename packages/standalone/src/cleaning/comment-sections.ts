// SPDX-License-Identifier: Apache-2.0
// First-party structural comment-container policy, separate from HTML markup comments.

import { parseDocument } from '../metadata/dom.js';
import { isHtmlDocument } from './normalize.js';

const COMMENT =
  /(?:^|[\s_-])(?:comment(?:s|area|container|list|listing|thread)?|discussion|disqus)(?:$|[\s_-])/i;
const MARKER = 'data-markdownee-comment-excluded';
const FIELDS = ['id', 'class', 'itemprop', 'data-testid', 'aria-label'];

/** Mark first, then remove outer comment containers without changing the traversal snapshot. */
export function excludeCommentSections(html: string): string {
  const document = parseDocument(html);
  const candidates = document.querySelectorAll(FIELDS.map((name) => `[${name}]`).join(', '));
  for (const element of candidates) {
    const matched = FIELDS.some((name) => {
      const value =
        name === 'id'
          ? element.id
          : name === 'class'
            ? element.className
            : element.getAttribute(name);
      return value !== null && COMMENT.test(value);
    });
    if (matched && !element.parentElement?.closest(`[${MARKER}]`)) element.setAttribute(MARKER, '');
  }
  for (const element of document.querySelectorAll(`[${MARKER}]`)) element.remove();
  return isHtmlDocument(html) ? String(document) : (document.body?.innerHTML ?? '');
}
