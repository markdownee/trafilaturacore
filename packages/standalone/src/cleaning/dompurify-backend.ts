// SPDX-License-Identifier: Apache-2.0
// First-party optional DOMPurify/jsdom adapter. Dependency implementations are not copied.

import sanitizeHtml from 'sanitize-html';
import { type Cleaner, filterEventHandlers } from './cleaner.js';
import { isHtmlDocument } from './normalize.js';

interface PurifyOptions {
  ALLOWED_TAGS: string[];
  ALLOWED_ATTR: string[];
  ALLOW_DATA_ATTR: boolean;
  WHOLE_DOCUMENT: boolean;
  FORBID_TAGS: string[];
}
interface Purifier {
  sanitize(html: string, options: PurifyOptions): string;
}
type Factory = (window: unknown) => Purifier;

/** Construct lazily; absence is handled by the caller's explicit fallback diagnostic. */
export async function createDompurifyBackend(): Promise<Cleaner> {
  const purifyModule = (await import('dompurify')) as { default: Factory };
  const domModule = (await import('jsdom')) as { JSDOM: new (html: string) => { window: unknown } };
  const purifier = purifyModule.default(new domModule.JSDOM('').window);
  return {
    name: 'dompurify',
    clean(html, config) {
      // The declared sanitizer implements literal and wildcard tag transforms without
      // treating a caller's tag name as a regular expression.
      const transformed =
        config.transformTags === undefined
          ? html
          : sanitizeHtml(html, {
              allowedTags: false,
              allowedAttributes: false,
              allowVulnerableTags: true,
              transformTags: config.transformTags,
            });
      const tags = config.allowedTags ?? [];
      const attributes = filterEventHandlers(config.allowedAttributes ?? {});
      const names = new Set<string>();
      for (const group of Object.values(attributes)) for (const name of group) names.add(name);
      return purifier.sanitize(transformed, {
        ALLOWED_TAGS: tags,
        ALLOWED_ATTR: [...names],
        ALLOW_DATA_ATTR: false,
        WHOLE_DOCUMENT: isHtmlDocument(transformed) && tags.includes('html'),
        FORBID_TAGS: ['script', 'textarea', 'option'].filter((name) => !tags.includes(name)),
      });
    },
  };
}
