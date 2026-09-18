import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  Boilerplate,
  CommentHandling,
  clean,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_MAX_INPUT_BYTES,
  ImageHandling,
  LinkHandling,
  TableHandling,
} from '@markdownee/trafilaturacore';

// trafilaturacore is HTML in -> cleaned HTML out, and OFFLINE: clean() never
// fetches the network. Everything below runs against a local sample file.
const samplePath = fileURLToPath(new URL('../../sample.html', import.meta.url));
const html = await readFile(samplePath, 'utf8');

console.log('default boilerplate mode:', DEFAULT_BOILERPLATE_MODE);
console.log('default maxInputBytes:', DEFAULT_MAX_INPUT_BYTES);

// The simplest call: defaults to `balanced`, keeps
// comments/tables/images/links. Boilerplate (nav, sidebar, footer) is
// dropped; the article body is kept.
const result = await clean(html);
console.log('cleaned html length:', result.html.length);

// The metadata sidecar is additive — it never replaces or converts the HTML.
console.log('title:', result.metadata?.title);
console.log('author:', result.metadata?.author);

// Non-fatal diagnostics surface as messages rather than throws.
for (const message of result.messages) {
  console.log(`[${message.type}] ${message.text}`);
}

// The four boilerplate modes. `keep` skips main-content extraction entirely
// (HTML cleanup only) while still validating resources before parsing.
const modes = Object.values(Boilerplate);
for (const boilerplate of modes) {
  const r = await clean(html, { boilerplate });
  console.log(`${boilerplate}: ${r.html.length} bytes`);
}

// Content-handling modes default to `include`; `exclude` subtracts that content
// family. Comment exclusion removes structurally detected user-comment sections.
// Images also support 'alt-text' and 'resolved-url'.
const lean = await clean(html, {
  imageHandling: ImageHandling.Exclude,
  linkHandling: LinkHandling.Exclude,
  tableHandling: TableHandling.Exclude,
  commentHandling: CommentHandling.Exclude,
});
console.log('lean has <img>?', lean.html.includes('<img'));
console.log('lean has <a href>?', lean.html.includes('<a href'));
console.log('lean has <table>?', lean.html.includes('<table'));

// `url` is context only — used by the metadata sidecar and image-URL
// resolution. It is NEVER fetched.
const withUrl = await clean(html, {
  url: 'https://example.com/blog/how-boilerplate-removal-works',
});
console.log('metadata url:', withUrl.metadata?.url);
console.log('hostname:', withUrl.metadata?.hostname);

// A custom cleaning config (plain JSON data) REPLACES the default
// Trafilatura-aligned config. The unconditional security floor still applies:
// <script>, on* handlers, and dangerous URL schemes are always stripped.
const custom = await clean(html, {
  config: {
    allowedTags: ['h1', 'h2', 'p', 'a', 'strong', 'em'],
    allowedAttributes: { a: ['href'] },
  },
});
console.log('custom-config length:', custom.html.length);

// Boundary guards reject bad input rather than silently degrading.
try {
  await clean(html, { maxInputBytes: 10 });
} catch (error) {
  const name = (error as RangeError).constructor.name;
  console.log('oversized input rejected:', name);
}
try {
  // An invalid mode is rejected at the boundary (the cast mimics
  // untrusted input).
  await clean(html, { boilerplate: 'nonsense' as never });
} catch (error) {
  console.log('invalid mode rejected:', (error as TypeError).constructor.name);
}
