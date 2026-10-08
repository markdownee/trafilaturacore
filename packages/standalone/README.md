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
          </li>
          <li>
            <strong><a href="https://pypi.org/project/trafilaturacore/">Python library on PyPI</a></strong>
          </li>
          <li>
            <strong><a href="https://github.com/markdownee/trafilaturacore">Source code on GitHub</a></strong>
          </li>
        </ul>
        <h3>Docs</h3>
        <ul>
          <li><a href="https://www.trafilaturacore.com/help/getting-started/">Getting started</a></li>
          <li><a href="https://www.trafilaturacore.com/help/npm-cli/">CLI help</a></li>
          <li><a href="https://www.trafilaturacore.com/help/npm-library/">Library help</a></li>
        </ul>
        <h3>Social</h3>
        <ul>
          <li><a href="https://github.com/markdownee/trafilaturacore">Star us on GitHub</a></li>
          <li><a href="https://github.com/markdownee">Follow us on GitHub</a></li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

Trafilatura Core extracts main content by removing boilerplate from HTML documents.

- Two language versions — **TypeScript** and **Python**: available as a [TypeScript library on npm](https://www.npmjs.com/package/@markdownee/trafilaturacore) and a [Python library on PyPI](https://pypi.org/project/trafilaturacore/).

- This **open-source TypeScript port** follows [Python Trafilatura](https://github.com/adbar/trafilatura)'s `fast=True` extraction path, with [go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation aid. Trafilatura Core also has a native Python implementation, translated from this TypeScript code.

- The _Core_ in its name means it is reduced to one task: extracting main content by removing boilerplate. An optional Source URL supplies metadata and image-resolution context; it is _never fetched_. Use [Turndown](https://www.npmjs.com/package/turndown) for Markdown conversion and [Markdownee](https://www.markdownee.com/) for crawling live websites.

- [Compared with Mozilla Readability](https://www.trafilaturacore.com/comparison/), Trafilatura and Trafilatura Core use layered structural and content heuristics with fallback and recall escalation, rather than centering extraction on the candidate scoring inherited from Arc90’s original readability.js article extractor; Trafilatura Core also offers configuration options for boilerplate removal.

This package provides the TypeScript library and CLI. It returns cleaned HTML, available page metadata, and diagnostic messages.

Choose precision, balanced, or recall extraction, or keep for whole-document
cleanup. Images, links, tables, and detected user-comment sections have separate
controls. Output is compact HTML; if formatting fails, the cleaned HTML is
returned with a warning.

Pass the cleaned HTML to your application or save it to a file with the CLI.
The [library reference](https://www.trafilaturacore.com/help/npm-library/) covers
custom cleaning rules and resource limits; the
[CLI guide](https://www.trafilaturacore.com/help/npm-cli/) covers file input,
standard input, and JSON results.

The CLI reads a local file or standard input and can write cleaned HTML or a JSON
result. Library calls return `html`, `messages`, and available metadata. Custom
configuration uses JSON fields from the
[library reference](https://www.trafilaturacore.com/help/npm-library/); inputs beyond
`maxInputBytes` raise `RangeError`. Select resource limits for the documents your
application accepts, and inspect diagnostic messages alongside the extracted HTML.

## Usage: library

Use Node.js 22.22.2+ on 22.x, 24.15.0+ on 24.x, or 26+, then install the package:

```bash
npm init -y
npm install @markdownee/trafilaturacore
```

Save this as `clean.mjs` (`.mjs` enables ES modules):

```javascript
import { clean } from '@markdownee/trafilaturacore';

const input = `<nav>Home</nav><article><h1>Reading saved pages</h1>
<p>Save the original HTML before cleaning a page. A local copy lets
you compare the extracted article with its navigation and footer.</p>
<p>Keep the source address beside the snapshot. It provides context
when relative image links need to be resolved after extraction.</p>
</article>`;
const { html } = await clean(input);
console.log(html);
```

```bash
node clean.mjs
```

This prints the article heading and paragraphs without the navigation.
The [library reference](https://www.trafilaturacore.com/help/npm-library/)
covers options, metadata, custom cleaning, and resource limits.

## Usage: CLI

With the package installed above, read supplied HTML from stdin:

```bash
printf '%s\n' '<nav>Home</nav><p>Saved article text.</p>' |
  npx trafilaturacore --boilerplate keep --output cleaned.html
```

The command writes `<p>Saved article text.</p>` to `cleaned.html`.
Here `keep` skips main-content extraction but still applies cleanup.
Omit `--output` for stdout or add `--json` for the result envelope.
See the [CLI reference](https://www.trafilaturacore.com/help/npm-cli/) for
file input, configuration, and all flags.

Extraction is not a security boundary. Before rendering untrusted output,
apply sanitization appropriate to your output context and a Content Security
Policy. Remote links and images may remain in the result.

## Acknowledgements

- [Trafilatura](https://github.com/adbar/trafilatura) — original Python
  implementation by Adrien Barbaresi.

- [go-trafilatura](https://github.com/markusmobius/go-trafilatura) — Go port by
  Markus Mobius, used as a DOM translation aid.

## Support

Report problems in the
[issue tracker](https://github.com/markdownee/trafilaturacore/issues).

## License

Licensed under the [Apache License, Version 2.0](./LICENSE). See the compact
[third-party notices](https://github.com/markdownee/trafilaturacore/blob/main/THIRD-PARTY-NOTICES.txt)
(shipped at `dist/THIRD-PARTY-NOTICES.txt`).
