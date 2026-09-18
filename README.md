# trafilaturacore

<table align="right">
  <tbody>
    <tr>
      <td>
        <img width="220" src="media/cover-mini.svg" alt="Trafilatura Core — wire-drawing illustration" />
        <br />
        <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="license: Apache-2.0" /></a>
        <br />
        <a href="https://github.com/markdownee/trafilaturacore/actions/workflows/release-npm.yml"><img src="https://github.com/markdownee/trafilaturacore/actions/workflows/release-npm.yml/badge.svg" alt="release" /></a>
        <br />
        <a href="https://github.com/markdownee/trafilaturacore"><img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="status: alpha" /></a>
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
            <sub>alpha / pre-release</sub>
          </li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

Trafilatura Core is primarily an open-source TypeScript port of
[Python Trafilatura](https://github.com/adbar/trafilatura) v2.2.0. It converts
supplied HTML into clean main-content HTML: it removes navigation, sidebars,
footers, and similar boilerplate, then normalizes and sanitizes the result.

The npm package contains JavaScript and needs no native compilation. A maintained
alpha native Python library translates the TypeScript engine and retains native
validation, metadata adapters and cleaning. It bundles no Node product
engine and exposes no Python CLI. Both languages remain in this repository.
A parity suite requires the port to agree with pinned Python
Trafilatura on the selected text of every committed fixture, in all three
boilerplate modes that extract main content: precision, balanced, and recall.
It checks the upstream `fast=True` path, which omits the Readability and jusText
comparisons; results can differ from upstream's `fast=False` default.

The extraction core ports the Python extraction path;
[go-trafilatura](https://github.com/markusmobius/go-trafilatura) is used only as
an aid when translating Python tree operations to a typed DOM. Metadata
extraction is likewise a direct port of the Python project.

Choose precision, balanced, recall, or keep mode for boilerplate handling, then
control images, links, tables, and user-comment sections
separately. Comment exclusion removes structurally detected user-comment
containers.

Trafilatura Core never fetches URLs. The optional Source URL supplies metadata
and image-resolution context only. For crawling, browser rendering, or Markdown,
text, and JSON output workflows, use
[Markdownee](https://www.markdownee.com/).

The TypeScript library and CLI are alpha, pre-release surfaces that can be built
from source. The [online playground](https://www.trafilaturacore.com/) runs the same
`clean()` pipeline. Output format is not configurable: the result is compact
HTML, or, if presentation formatting fails, the cleaned unformatted HTML with a
warning.

Scripts, event handlers, dangerous URL schemes, and unsafe inline CSS are
removed on both the default and custom-config paths.

Trafilatura Core is not a security boundary. If you render this output in a
context you do not control, sanitize at your own output boundary (for example
with DOMPurify) and apply a CSP.

## Status

Alpha. APIs may change before a stable release.

## Contents

- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Library API](#library-api)
- [CLI reference](#cli-reference)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)

## Repository layout

This is a pnpm + turbo monorepo.

- `@/packages/standalone/` — the TypeScript library (the npm package
  `trafilaturacore`). Strict TypeScript, Node 22+. Holds metadata extraction and the
  Trafilatura-aligned HTML-cleaning stage; the extraction core lives in
  `@/packages/standalone/src/core/`. Exposed both as the `clean()` library API and as an
  offline `trafilaturacore` CLI (reads a file or stdin, writes cleaned HTML to
  stdout; never fetches).
- `@/packages/standalone-python/` — the maintained alpha native Python library.
  Python 3.10+, with its own extraction/cleaning pipeline and no product CLI.
  Dependencies install separately; the product wheel contains no bundled JavaScript.
- `@/examples/` — runnable examples for each surface: the npm CLI
  (`examples/npm-cli/`), the npm library (`examples/npm-library/`), and the PyPI
  library (`examples/pypi-library/`), all cleaning the shared
  `examples/sample.html`.
- `@/media/` — the brand assets used by the registry READMEs.

## Quick start

```bash
# Install workspace dependencies
pnpm install

# Build, then test the local package
pnpm --filter @markdownee/trafilaturacore build
pnpm --filter @markdownee/trafilaturacore test
```

Use it as a **library**:

```ts
import { Boilerplate, clean, ImageHandling } from './packages/standalone/dist/index.js';

const pageHtml = '<main><h1>Example</h1><p>Supplied HTML.</p></main>';
const { html, metadata } = await clean(pageHtml, {
  boilerplate: Boilerplate.Balanced,
  imageHandling: ImageHandling.Exclude,
});
```

Raw strings remain accepted; the alias objects serialize to those same values.

…or as a **CLI** (offline — reads a file or stdin, writes cleaned HTML to stdout):

```bash
# committed sample → compact HTML on stdout
node packages/standalone/dist/cli.js examples/sample.html -b balanced

# drop images, flatten links
node packages/standalone/dist/cli.js examples/sample.html --image-handling exclude --link-handling exclude

# full JSON result on stdout
node packages/standalone/dist/cli.js examples/sample.html --json
```

The package build emits a self-contained ESM bundle under `dist/`; it carries no
native artifact.

## Native Python library

```bash
pip install --pre trafilaturacore
```

```python
from trafilaturacore import clean

result = clean("<p>Hello <strong>world</strong>.</p>", boilerplate="keep")
print(result.html)
```

`aclean()` is the awaitable form. TypeScript remains primary; Python uses the same
boilerplate and content-handling vocabulary, with deliberate parser, serialization,
and custom-style differences documented in its [README](./packages/standalone-python/README.md).
Neither implementation fetches the optional URL context.

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

## Architecture

Extraction runs in process in `src/core/`, a TypeScript port of the Python
extraction path that returns unsanitized HTML over a parse5-backed
lxml-semantics tree. The cleaning stage then normalizes, sanitizes, and formats
that output, and extracts the metadata sidecar; its DOM parsing also uses
`parse5`, so one parser owns tree construction end to end.

## Contributing

Issues and pull requests are welcome in the
[public repository](https://github.com/markdownee/trafilaturacore). Build and test
the local package with the commands above before submitting a change.

## Acknowledgements

- [Trafilatura](https://github.com/adbar/trafilatura) — original Python implementation by Adrien Barbaresi, and the implementation this engine ports.
- [go-trafilatura](https://github.com/markusmobius/go-trafilatura) — Go port by Markus Mobius, used as a DOM translation aid.

Licensed under the [Apache License, Version 2.0](LICENSE). See the compact
[third-party notices](THIRD-PARTY-NOTICES.txt).
