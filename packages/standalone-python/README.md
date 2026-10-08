# Trafilatura Core

<table>
  <tbody>
    <tr>
      <td>
        <img align="right" width="220" src="https://www.trafilaturacore.com/media/logo.svg" alt="Trafilatura Core" />
        <a href="https://pypi.org/project/trafilaturacore/"><img src="https://img.shields.io/pypi/v/trafilaturacore.svg" alt="PyPI version" /></a>
        <a href="https://pypi.org/project/trafilaturacore/"><img src="https://img.shields.io/pypi/dm/trafilaturacore.svg" alt="PyPI downloads" /></a>
        <a href="https://github.com/markdownee/trafilaturacore/blob/main/LICENSE"><img src="https://img.shields.io/pypi/l/trafilaturacore.svg" alt="license" /></a>
        <h3>Also available as:</h3>
        <strong><a href="https://www.trafilaturacore.com/">Online playground</a></strong> | <strong><a href="https://www.npmjs.com/package/@markdownee/trafilaturacore">npm package CLI &amp; lib</a></strong> | <strong><a href="https://github.com/markdownee/trafilaturacore">Source code on GitHub</a></strong>
        <h3>Docs</h3>
        <strong><a href="https://www.trafilaturacore.com/help/getting-started/">Getting started</a></strong> | <strong><a href="https://www.trafilaturacore.com/help/pypi/">Python library help</a></strong>
        <h3>Social</h3>
        <strong><a href="https://github.com/markdownee/trafilaturacore">Star us on GitHub</a></strong> | <strong><a href="https://github.com/markdownee">Follow us on GitHub</a></strong>
      </td>
    </tr>
  </tbody>
</table>

Trafilatura Core extracts main content by removing boilerplate from HTML documents.

- Two language versions — **TypeScript** and **Python**: available as a [TypeScript library on npm](https://www.npmjs.com/package/@markdownee/trafilaturacore) and a [Python library on PyPI](https://pypi.org/project/trafilaturacore/).

- This is Trafilatura Core's **open-source native Python implementation**. It translates the TypeScript port of [Python Trafilatura](https://github.com/adbar/trafilatura)'s `fast=True` extraction path. [go-trafilatura](https://github.com/markusmobius/go-trafilatura) served as a DOM translation aid for the TypeScript port.

- The _Core_ in its name means it is reduced to one task: extracting main content by removing boilerplate. An optional Source URL supplies metadata and image-resolution context; it is _never fetched_. Use [Turndown](https://www.npmjs.com/package/turndown) for Markdown conversion and [Markdownee](https://www.markdownee.com/) for crawling live websites.

- [Compared with Mozilla Readability](https://www.trafilaturacore.com/comparison/), Trafilatura and Trafilatura Core use layered structural and content heuristics with fallback and recall escalation, rather than centering extraction on the candidate scoring inherited from Arc90’s original readability.js article extractor; Trafilatura Core also offers configuration options for boilerplate removal.

This package provides the native Python library, with library APIs only. It returns cleaned HTML, diagnostics, and available page metadata; see the [Python reference](https://www.trafilaturacore.com/help/pypi/) for language differences.

## Install and use

Requires Python 3.10 or newer:

```bash
pip install trafilaturacore
```

Save this as `clean.py`:

```python
from trafilaturacore import clean

source = """<nav>Home</nav><article><h1>Reading saved pages</h1>
<p>Save the original HTML before cleaning a page. A local copy lets
you compare the extracted article with its navigation and footer.</p>
<p>Keep the source address beside the snapshot. It provides context
when relative image links need to be resolved after extraction.</p>
</article>"""
result = clean(source)
print(result.html)
```

```bash
python clean.py
```

The result prints the article heading and paragraphs without navigation.
`clean()` accepts a string or UTF-8 bytes. Its `CleanResult` has `html`,
`messages`, and optional `metadata`; `aclean()` accepts the same options
for async callers. Cancelling its await does not stop an already running worker.

## Configure cleanup

Select `precision`, `balanced` (default), or `recall` for extraction;
`keep` cleans the whole document. Image, link, table, and user-comment handling
are independent. The [Python reference](https://www.trafilaturacore.com/help/pypi/)
covers options, custom policies, async usage, resource limits, and errors.

Python uses lxml and nh3. Parsing, serialization, date/URL handling, custom
configuration, CSS preservation, diagnostics, and limits can differ from the
TypeScript library. Dependencies install separately; platforms without compatible
dependency wheels need their build prerequisites.

Extraction is not a security boundary. Before rendering untrusted output,
apply sanitization appropriate to your output context and a Content Security
Policy. Remote links and images may remain.

## Acknowledgements

- [Trafilatura](https://github.com/adbar/trafilatura) — original Python
  implementation by Adrien Barbaresi.
- [go-trafilatura](https://github.com/markusmobius/go-trafilatura) — Go port by
  Markus Mobius, used as a DOM translation aid.

See [About](https://www.trafilaturacore.com/about/) for extraction lineage and scope.

## Support

Report problems in the
[issue tracker](https://github.com/markdownee/trafilaturacore/issues).

## License

Licensed under [Apache-2.0](https://github.com/markdownee/trafilaturacore/blob/main/LICENSE).
See the compact [third-party notices](https://github.com/markdownee/trafilaturacore/blob/main/THIRD-PARTY-NOTICES.txt).
