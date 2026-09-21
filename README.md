# Trafilatura Core

<table align="right">
  <tbody>
    <tr>
      <td>
        <img width="220" src="media/logo.svg" alt="Trafilatura Core" />
        <br />
        <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="license: Apache-2.0" /></a>
        <br />
        <a href="https://github.com/markdownee/trafilaturacore/actions/workflows/release-npm.yml"><img src="https://github.com/markdownee/trafilaturacore/actions/workflows/release-npm.yml/badge.svg" alt="release" /></a>
        <br />
        <a href="https://github.com/markdownee/trafilaturacore"><img src="https://img.shields.io/badge/languages-TypeScript%20%2B%20Python-blue.svg" alt="TypeScript and Python" /></a>
        <h3>Available as:</h3>
        <ul>
          <li>
            <strong><a href="https://www.trafilaturacore.com/">Online playground</a></strong>
            <br />
            <sub><a href="https://www.trafilaturacore.com/">playground</a>, <a href="https://www.trafilaturacore.com/help/">help</a></sub>
          </li>
          <li>
            <strong><a href="https://www.npmjs.com/package/@markdownee/trafilaturacore">npm package</a></strong>
            <br />
            <sub><a href="https://www.npmjs.com/package/@markdownee/trafilaturacore">package</a>, <a href="https://www.trafilaturacore.com/help/">help</a></sub>
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

The npm package contains JavaScript and needs no native compilation. A maintained
native Python library translates the TypeScript engine and retains native
validation, metadata adapters and cleaning. It bundles no Node product
engine and exposes no Python CLI. Both languages remain in this repository.
A parity suite requires the port to agree with pinned Python
Trafilatura on the selected text of every committed fixture, in all three
boilerplate modes that extract main content: precision, balanced, and recall.
It checks the upstream `fast=True` path, which omits the Readability and jusText
comparisons; results can differ from upstream's `fast=False` default.

Metadata extraction is likewise a direct port of the Python project.

Choose precision, balanced, recall, or keep mode for boilerplate handling, then
control images, links, tables, and user-comment sections
separately. Comment exclusion removes structurally detected user-comment
containers.

Trafilatura Core never fetches URLs. The optional Source URL supplies metadata
and image-resolution context only. For crawling, browser rendering, or Markdown,
text, and JSON output workflows, use
[Markdownee](https://www.markdownee.com/).

The TypeScript library and CLI can be built from source.
The [online playground](https://www.trafilaturacore.com/) runs the same
`clean()` pipeline. Output format is not configurable: the result is compact
HTML, or, if presentation formatting fails, the cleaned unformatted HTML with a
warning.

Scripts, event handlers, dangerous URL schemes, and unsafe inline CSS are
removed on both the default and custom-config paths.

Trafilatura Core is not a security boundary. If you render this output in a
context you do not control, sanitize at your own output boundary (for example
with DOMPurify) and apply a CSP.

## Contents

- [Quick start](#quick-start)
- [Library API](#library-api)
- [CLI reference](#cli-reference)
- [Acknowledgements](#acknowledgements)

## Quick start

```bash
npm install @markdownee/trafilaturacore
```

Use it as a **library**:

```ts
import {
  Boilerplate,
  clean,
  ImageHandling,
} from '@markdownee/trafilaturacore';

const pageHtml = '<main><h1>Example</h1><p>Supplied HTML.</p></main>';
const { html, metadata } = await clean(pageHtml, {
  boilerplate: Boilerplate.Balanced,
  imageHandling: ImageHandling.Exclude,
});
```

Raw strings remain accepted; the alias objects serialize to those same values.

…or as a **CLI** (offline — reads a file or stdin, writes cleaned HTML to stdout):

```bash
# supplied HTML → compact HTML on stdout
printf '%s\n' '<main><p>Supplied HTML.</p></main>' | \
  npx @markdownee/trafilaturacore -b balanced

# drop images, flatten links
printf '%s\n' '<main><p>Supplied HTML.</p></main>' | \
  npx @markdownee/trafilaturacore \
  --image-handling exclude --link-handling exclude

# full JSON result on stdout
printf '%s\n' '<main><p>Supplied HTML.</p></main>' | \
  npx @markdownee/trafilaturacore --json
```

## Native Python library

```bash
pip install trafilaturacore
```

```python
from trafilaturacore import clean

result = clean("<p>Hello <strong>world</strong>.</p>", boilerplate="keep")
print(result.html)
```

`aclean()` is the awaitable form. The two libraries use the same boilerplate and
content-handling vocabulary, with deliberate parser, serialization, and custom-style
differences documented in the Python [README](./packages/standalone-python/README.md).
Neither library fetches the optional URL context.

## Library API

`clean(html, options?)` is async. It returns cleaned `html`, diagnostic
`messages`, and an optional `metadata` sidecar. Its options are:

- `boilerplate`: `precision | balanced | recall | keep` (`balanced` by default).
  `keep` skips extraction, then cleans the whole document.
- `imageHandling`: `include | exclude | alt-text | resolved-url`; and
  `linkHandling`, `tableHandling`, and `commentHandling`: `include | exclude`.
  Every content family defaults to `include`, subject to extraction and cleaning
  rules. Comment exclusion removes structurally detected user-comment containers.
- `config`: a JSON-serializable `CleanConfig` that replaces the default cleaning
  config. Script, event-handler, and dangerous-URL filtering also applies to
  custom configurations.
- `url`: optional Source URL context for metadata and resolved image URLs. It is
  never fetched.
- `maxInputBytes`: UTF-8 input cap, defaulting to the exported 10 MB
  `DEFAULT_MAX_INPUT_BYTES`.

`prepare()` returns cleaned HTML before presentation formatting. Pass its `html` to `formatSecuredHtml()`
for the compact output. Invalid public options throw `TypeError`; oversized
input throws `RangeError`.

## CLI reference

Run the source-built CLI as
`node packages/standalone/dist/cli.js [input]`. The input can be a file,
`-`, or omitted for stdin. Cleaned HTML goes to stdout by default; diagnostics go
to stderr.

- `-b, --boilerplate <precision|balanced|recall|keep>` selects boilerplate mode.
- `-c, --config <file.json>` replaces the default cleaning config with JSON.
- `--image-handling <include|exclude|alt-text|resolved-url>`,
  `--link-handling <include|exclude>`, `--table-handling <include|exclude>`, and
  `--comment-handling <include|exclude>` set content handling.
- `-u, --url <url>` supplies context only and is never fetched.
- `-o, --output <file>` writes HTML to a file; `--json` emits the result envelope;
  `-q, --quiet` suppresses stderr diagnostics.

The JSON envelope contains cleaned HTML and messages plus optional metadata; it
is not a second engine content format.

Report problems through the
[issue tracker](https://github.com/markdownee/trafilaturacore/issues).

## Acknowledgements

- [Trafilatura](https://github.com/adbar/trafilatura) — original Python implementation by Adrien Barbaresi, and the implementation this engine ports.
- [go-trafilatura](https://github.com/markusmobius/go-trafilatura) — Go port by Markus Mobius, used as a DOM translation aid.

Licensed under the [Apache License, Version 2.0](LICENSE). See the compact
[third-party notices](THIRD-PARTY-NOTICES.txt).
