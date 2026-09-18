// SPDX-License-Identifier: Apache-2.0
// First-party sanitizer adapter and unconditional active-content policy.
// sanitize-html remains a separately installed dependency, not an implementation source.

import sanitizeHtml from 'sanitize-html';
import type { CleanConfig } from './config.js';

export interface Cleaner {
  readonly name: string;
  clean(html: string, config: CleanConfig): string;
}

const FORBIDDEN = new Set(['script', 'iframe', 'object', 'embed', 'applet', 'base']);
const URL_ATTRIBUTES = [
  'href',
  'src',
  'cite',
  'srcset',
  'action',
  'formaction',
  'poster',
  'background',
  'xlink:href',
  'longdesc',
  'usemap',
];

export function filterEventHandlers(
  attributes: Record<string, string[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(attributes).map(([tag, names]) => [
      tag,
      names.filter((name) => !name.toLowerCase().startsWith('on')),
    ]),
  );
}

function options(config: CleanConfig): sanitizeHtml.IOptions {
  const result: sanitizeHtml.IOptions = {};
  if (config.allowedTags !== undefined) {
    result.allowedTags = config.allowedTags.filter((tag) => !FORBIDDEN.has(tag.toLowerCase()));
  }
  if (config.allowedAttributes !== undefined)
    result.allowedAttributes = filterEventHandlers(config.allowedAttributes);
  if (config.allowedClasses !== undefined) result.allowedClasses = config.allowedClasses;
  if (config.selfClosing !== undefined) result.selfClosing = config.selfClosing;
  if (config.transformTags !== undefined) result.transformTags = { ...config.transformTags };
  if (config.nonTextTags !== undefined) {
    result.nonTextTags = config.nonTextTags.includes('script')
      ? config.nonTextTags
      : [...config.nonTextTags, 'script'];
  }
  if (config.allowedTags?.includes('style')) result.allowVulnerableTags = true;
  return result;
}

export const cleanHtmlBackend: Cleaner = {
  name: 'sanitize-html',
  clean: (html, config) => sanitizeHtml(html, options(config)),
};

const FLOOR: sanitizeHtml.IOptions = {
  allowedTags: false,
  allowedAttributes: false,
  allowVulnerableTags: true,
  allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: URL_ATTRIBUTES,
  nonTextTags: ['script', 'iframe', 'object', 'embed', 'applet'],
  exclusiveFilter(frame) {
    if (FORBIDDEN.has(frame.tag)) return true;
    return (
      frame.tag === 'meta' &&
      (frame.attribs['http-equiv'] !== undefined ||
        /^\s*\d+\s*;\s*url\s*=/i.test(frame.attribs.content ?? ''))
    );
  },
  transformTags: {
    '*': (tagName, attributes) => ({
      tagName,
      attribs: Object.fromEntries(
        Object.entries(attributes).filter(([name]) => {
          const lower = name.toLowerCase();
          return !lower.startsWith('on') && lower !== 'srcdoc';
        }),
      ),
    }),
  },
};

/** Apply regardless of custom configuration; CSS and foreign-content stabilization follow. */
export function enforceSecurityFloor(html: string): string {
  return sanitizeHtml(html, FLOOR);
}
