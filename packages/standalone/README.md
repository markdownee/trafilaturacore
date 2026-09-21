# Trafilatura Core

<table align="right">
  <tbody>
    <tr>
      <td>
        <img width="220" src="https://www.trafilaturacore.com/media/logo.svg" alt="Trafilatura Core" />
        <br />
        <a href="https://www.npmjs.com/package/@markdownee/trafilaturacore"><img src="https://img.shields.io/npm/v/%40markdownee%2Ftrafilaturacore.svg" alt="npm version" /></a>
        <br />
        <a href="https://github.com/markdownee/trafilaturacore/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/%40markdownee%2Ftrafilaturacore.svg" alt="license" /></a>
        <br />
        <a href="https://github.com/markdownee/trafilaturacore/actions/workflows/release-npm.yml"><img src="https://github.com/markdownee/trafilaturacore/actions/workflows/release-npm.yml/badge.svg" alt="release" /></a>
        <br />
        <a href="https://github.com/markdownee/trafilaturacore"><img src="https://img.shields.io/badge/languages-TypeScript%20%2B%20Python-blue.svg" alt="TypeScript and Python" /></a>
        <h3>Also available as:</h3>
        <ul>
          <li>
            <strong><a href="https://www.trafilaturacore.com/">Online playground</a></strong>
            <br />
            <sub><a href="https://www.trafilaturacore.com/">playground</a>, <a href="https://www.trafilaturacore.com/help/">help</a></sub>
          </li>
          <li>
            <strong><a href="https://github.com/markdownee/trafilaturacore">Source code on GitHub</a></strong>
          </li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

Trafilatura Core is a library for main-content extraction and boilerplate removal from HTML documents.

- Two language versions — **TypeScript** and **Python**: available as a [TypeScript library on npm](https://www.npmjs.com/package/@markdownee/trafilaturacore) and a [Python library on PyPI](https://pypi.org/project/trafilaturacore/).
- Trafilatura Core is an **open-source fork** of the Python library [Trafilatura](https://github.com/adbar/trafilatura), with [go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation aid.
- The **Core** in the name means it is reduced to one task: main-content extraction and boilerplate removal. Other packages should handle output conversion to Markdown or other formats, such as [Turndown](https://www.npmjs.com/package/turndown) for Markdown, and fetching and crawling, such as [Markdownee](https://www.markdownee.com/).

This TypeScript package converts supplied HTML into clean main-content HTML,
combining two stages behind one API:

- **Extraction** — the main-content layer that removes navigation, sidebars,
  footers, and similar boilerplate. It is a direct port of Python Trafilatura
  v2.2.0's `fast=True` extraction path. A parity suite compares the selected text with that
  pinned upstream path on every committed fixture, in all three boilerplate modes
  that extract main content: precision, balanced, and recall.
  Upstream's two extractor-comparison stages depend on third-party extractors and
  are excluded with that path, so results can differ from upstream's `fast=False`
  default. No Python runtime, no model, no GPU.
- **Cleaning** — a
  [`sanitize-html`](https://www.npmjs.com/package/sanitize-html)-based
  normalization, sanitization, and formatting stage.
  Metadata extraction is likewise a direct port of Python Trafilatura.

The package ships JavaScript, without a native addon or platform-specific engine
binary.

Trafilatura Core never fetches URLs. The optional Source URL supplies metadata
and image-resolution context only. It never converts the cleaned HTML to
Markdown, XML, or plain text.

Try it in the [online playground](https://www.trafilaturacore.com/) — paste HTML,
adjust the settings, and preview the matching CLI command or `clean()` call.
Previews use placeholder HTML for long inputs; replace it with your document.
To crawl and extract live websites online, use
[Markdownee](https://www.markdownee.com/), which adds browser rendering and
Markdown, text, and multi-format output workflows.

## Native Python alternative

A maintained [Python library](https://pypi.org/project/trafilaturacore/) implements
the supplied-HTML API natively in Python; it has no product CLI or bundled Node
product engine. See the [Python guide](https://www.trafilaturacore.com/help/) for
installation, API differences, and examples.

## Usage

```ts
import { Boilerplate, clean } from '@markdownee/trafilaturacore';

const pageHtml = '<main><h1>Example</h1><p>Supplied HTML.</p></main>';
const { html, metadata, messages } = await clean(pageHtml, {
  boilerplate: Boilerplate.Balanced,
  url: 'https://en.wikipedia.org/wiki/Web_scraping', // optional context; never fetched
});
```

`clean()` returns cleaned **HTML** plus an optional `metadata` sidecar (title,
author, date, sitename, tags, …) and diagnostic `messages`. It is `async` (the
formatter loads lazily). `metadata.declaredPageType` carries the page's raw
OpenGraph `og:type`, or an upstream-recognized, lowercased JSON-LD `@type` when
OpenGraph did not supply one. It is descriptive metadata only, never a classifier
verdict and never used to steer extraction.

`prepare()` returns cleaned HTML before presentation formatting. It applies the
same extraction and cleaning settings as `clean()`. Pass its HTML to
`formatSecuredHtml()` to produce the compact output without running the
cleaning pipeline again:

```ts
import {
  Boilerplate,
  formatSecuredHtml,
  prepare,
} from '@markdownee/trafilaturacore';

const pageHtml = '<main><h1>Example</h1><p>Supplied HTML.</p></main>';
const prepared = await prepare(pageHtml, { boilerplate: Boilerplate.Balanced });
const { html: compactHtml } = await formatSecuredHtml(prepared.html);
```

If formatting fails, the cleaned unformatted HTML is returned with a stable
warning in `messages`.

Each boilerplate mode works with the default or a custom cleaning config. Four
`*Handling` options control images, links, tables, and user-comment sections.
The default cleaning stage uses the exported `DEFAULT_CLEAN_CONFIG`, derived from
Trafilatura 2.2.0: its tag allow-list is Trafilatura's HTML output vocabulary
plus the semantic tags Trafilatura neither deletes nor unwraps, which
`boilerplate: 'keep'` needs when it cleans a whole document without extracting;
Trafilatura's `MANUALLY_CLEANED`
list maps to `nonTextTags` (subtree discarded with content: `nav`, `aside`,
`form`, `iframe`, `script`, …); its `MANUALLY_STRIPPED` list is simply not
allowed, so those tags are unwrapped with content kept (`div`, `span`,
`section`, …). `boilerplate: 'keep'` skips extraction and cleans the whole
document after the tokenizer's validation-only resource preflight.

### Content-handling modes

All four content-handling options default to **`include`**. Included content
still passes through extraction and cleaning; it may be removed by those stages.

- `imageHandling` — `include` | `exclude` | `alt-text` | `resolved-url`. `exclude`
  discards image subtrees (`img`/`figure`/`figcaption`/`picture`/`source`);
  `alt-text` replaces each image with a src-less `<img alt="…">` stand-in (alt
  falls back through `alt` → `figcaption` → `aria-label` → `aria-labelledby` →
  `title`; an explicit `alt=""` marks a decorative image, which is removed);
  `resolved-url` normalizes image structures to `<img>` elements and resolves
  their URLs against the `url` option, falling back to the document's `<base href>`.
  The image pass supports lazy-load `data-src` and `srcset` candidates. Without a
  base URL, relative URLs remain relative and produce a warning.
- `linkHandling` — `include` | `exclude`. `exclude` unwraps `<a>`, keeping the anchor
  text but dropping `href`.
- `tableHandling` — `include` | `exclude`. `exclude` discards table subtrees
  (`table`/`caption`/`tr`/`td`/`th`/`colgroup`/`col`, including cell text).
- `commentHandling` — `include` | `exclude`, for user-comment sections
  (forum/blog comments, not `<!-- -->` markup). `exclude` removes structurally
  detected comment containers.

```ts
import {
  clean,
  ImageHandling,
  LinkHandling,
} from '@markdownee/trafilaturacore';

const pageHtml = '<main><h1>Example</h1><p>Supplied HTML.</p></main>';
const { html } = await clean(pageHtml, {
  imageHandling: ImageHandling.Exclude,
  linkHandling: LinkHandling.Exclude,
});
```

The full alt-text fallback chain and image-source selection apply in `keep`
mode. Extraction can discard captions, ARIA attributes, `srcset`, and picture
markup before image handling runs, leaving fewer fallbacks in the other modes.

Exclusion is opt-in. Internally,
`include`/`exclude` derive via `deriveContentConfig(base, handling)`
(`src/cleaning/config.ts`) — when nothing subtracts it returns the base config
unchanged, so the default cleaning path stays byte-identical — while
`imageHandling: 'alt-text' | 'resolved-url'` runs a pre-sanitize image pass in
the cleaning stage. Each mode is validated at the boundary; an unknown member
throws a `TypeError` listing the valid set.

Raw string values remain accepted; the alias objects are typed conveniences that serialize to the same strings.

### Custom cleaning config

Pass a custom `config` as a `CleanConfig` object of JSON-serializable data. It
**replaces the default Trafilatura-aligned config**:

```ts
import {
  Boilerplate,
  clean,
  type CleanConfig,
} from '@markdownee/trafilaturacore';

const pageHtml = '<main><h1>Example</h1><p>Supplied HTML.</p></main>';
const config: CleanConfig = {
  allowedTags: ['p', 'a', 'strong', 'em'],
  allowedAttributes: { a: ['href'] },
};
const { html } = await clean(pageHtml, {
  boilerplate: Boilerplate.Balanced,
  config,
});
```

`CleanConfig` fields: `allowedTags`, `allowedAttributes`, `allowedClasses`,
`selfClosing`, `nonTextTags`, `transformTags` — all JSON-serializable. The config
is validated at the boundary (`clean()` throws a `TypeError` on an unknown or
wrong-typed field; the guards `isCleanConfig` / `cleanConfigError` are
exported). Script and event-handler filtering also applies to custom configs;
allowing inline `style` retains CSS-URL filtering.

On the default config and any custom config alike, the final pass removes
`<script>` (tag + text), every `on*` event handler,
`javascript:`/`vbscript:`/untrusted `data:` URLs, and dangerous inline CSS
(`url(javascript:)`, `expression()`, `@import`). A custom config that permits
inline `style` adds the CSS-URL allow-list on top.

Trafilatura Core is not a security boundary. If you render this output in a
context you do not control, sanitize at your own output boundary (for example
with DOMPurify) and apply a CSP.

### Boundary validation and input cap

`clean()` applies these checks at the boundary — a type check, a byte cap, and a
token and depth preflight:

- It throws a `TypeError` when `html` is not a string, when `options.boilerplate`
  is provided but invalid, or when `options.config` is provided but is not a
  valid `CleanConfig`.
- It accepts `maxInputBytes?: number` (default 10 MB UTF-8, the exported
  `DEFAULT_MAX_INPUT_BYTES`) and throws a `RangeError` when the input's UTF-8 byte
  length exceeds it — a resource bound. An explicit ceiling must be a positive
  safe integer; invalid numeric values cannot disable the guard. Pass a larger
  finite value to opt into bigger documents, up to the core's hard ceiling.
- Every mode runs the tokenizer's source-node, attribute, and depth
  preflight before metadata or cleaning enters a JavaScript DOM parser. `keep`
  uses the validation-only entry point; extracting modes perform the same pass
  inside extraction, without duplicating it. Structural limit failures reject
  with `ERR_TRAFILATURACORE_RESOURCE_LIMIT`. Extraction is synchronous and in process, so a
  large document occupies the event loop for its span; the deterministic ceilings, not
  cancellation, bound that cost.

## CLI

trafilaturacore ships a command-line tool with the same `clean()` pipeline. It is
**offline only**: it reads HTML from a file argument or stdin and writes cleaned
HTML to stdout (Unix-pipe friendly). It **never fetches the network** — `--url` is
context only (metadata + image resolution), exactly like the library option.

```sh
npm install -g @markdownee/trafilaturacore
# Or run on demand:
npx @markdownee/trafilaturacore --help
```

```bash
page_html='<main><h1>Example</h1><p>Supplied HTML.</p></main>'

# Clean stdin with the default settings (balanced boilerplate mode)
printf '%s\n' "$page_html" | trafilaturacore -b balanced

# Emit the full result as JSON (html + metadata + messages)
printf '%s\n' "$page_html" | trafilaturacore --json

# Write cleaned HTML to a temporary file instead of stdout
output_file="$(mktemp)"
printf '%s\n' "$page_html" | trafilaturacore -o "$output_file"
cat "$output_file"

# Use a temporary JSON cleaning config (replaces the default config)
config_file="$(mktemp)"
printf '%s\n' '{"allowedTags":["h1","p"]}' > "$config_file"
printf '%s\n' "$page_html" | trafilaturacore -c "$config_file"

rm -f "$output_file" "$config_file"
```

It reads a single file argument, or stdin when the argument is omitted or `-`.
Cleaned HTML (or `--json`) goes to **stdout**; diagnostics go to **stderr**
(silence them with `-q, --quiet`).
Options: `-b, --boilerplate <precision|balanced|recall|keep>`,
`-c, --config <file.json>` (a custom `CleanConfig`; replaces the default config),
`--image-handling <include|exclude|alt-text|resolved-url>` /
`--link-handling <include|exclude>` / `--table-handling <include|exclude>` /
`--comment-handling <include|exclude>` (content-handling modes, matching the
library `*Handling` options; each defaults to `include`),
`-u, --url <url>` (never fetched), `-o, --output <file>`, `--json`, `-q, --quiet`.
Invalid option values, an invalid/malformed config file, and a missing input file
exit non-zero with a clear stderr message.

## Acknowledgements

Report problems through the
[issue tracker](https://github.com/markdownee/trafilaturacore/issues).

- [Trafilatura](https://github.com/adbar/trafilatura) — original Python implementation by Adrien Barbaresi.
- [go-trafilatura](https://github.com/markusmobius/go-trafilatura) — Go port by Markus Mobius, used as a DOM translation aid.

Licensed under the [Apache License, Version 2.0](./LICENSE). See the compact
[third-party notices](https://github.com/markdownee/trafilaturacore/blob/main/THIRD-PARTY-NOTICES.txt)
(shipped in this package at `dist/THIRD-PARTY-NOTICES.txt`).
