# Trafilatura Core

[![PyPI version](https://img.shields.io/pypi/v/trafilaturacore.svg)](https://pypi.org/project/trafilaturacore/)
[![PyPI downloads](https://img.shields.io/pypi/dm/trafilaturacore.svg)](https://pypi.org/project/trafilaturacore/)
[![license](https://img.shields.io/pypi/l/trafilaturacore.svg)](https://github.com/markdownee/trafilaturacore/blob/main/LICENSE)

Trafilatura Core is a library for main-content extraction and boilerplate removal from HTML documents.

- Two language versions — **TypeScript** and **Python**: available as a [TypeScript library on npm](https://www.npmjs.com/package/@markdownee/trafilaturacore) and a [Python library on PyPI](https://pypi.org/project/trafilaturacore/).
- Trafilatura Core is an **open-source fork** of the Python library [Trafilatura](https://github.com/adbar/trafilatura), with [go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation aid.
- The **Core** in the name means it is reduced to one task: main-content extraction and boilerplate removal. Other packages should handle output conversion to Markdown or other formats, such as [Turndown](https://www.npmjs.com/package/turndown) for Markdown, and fetching and crawling, such as [Markdownee](https://www.markdownee.com/).

This native Python library extracts main content and cleans supplied HTML. Results
contain an HTML fragment, diagnostics, and page metadata. It implements
Trafilatura 2.2.0's fast path, with lxml and nh3 for parsing and cleaning.
htmldate and Courlan retain Python's date and URL behavior. It does not start
Node or bundle a JavaScript engine. Both language libraries live in the same
repository.

Trafilatura Core processes supplied HTML offline. The optional URL provides metadata and
image-resolution context; it is not a fetch request. Use
[Markdownee](https://www.markdownee.com/) for crawling and output conversion.

Trafilatura Core is not a security boundary. If you render this output in a context you do not
control, sanitize at your own output boundary and apply a CSP.

## Install

```bash
pip install "trafilaturacore==0.8.0"
```

Requires Python 3.10 or newer. The product wheel contains Python code; lxml and nh3 install
their own platform wheels. Systems without compatible dependency wheels need those projects'
build prerequisites. No Node installation is needed.

Python exposes library APIs only. It installs no `trafilaturacore` command and provides no
`python -m trafilaturacore` interface. The npm package retains its TypeScript CLI.

## Quick start

```python
from trafilaturacore import clean

result = clean(
    "<main><h1>Example</h1><p>Supplied HTML with <a href='/guide'>a guide</a>.</p></main>",
    boilerplate="keep",
    link_handling="exclude",
)
print(result.html)
# <h1>Example</h1><p>Supplied HTML with a guide.</p>
```

`clean()` accepts a string or UTF-8 bytes and returns a `CleanResult` dataclass:

- `html` — an HTML fragment with extraction and cleaning applied.
- `messages` — `Message(type, text)` diagnostics.
- `metadata` — a dictionary with available title, author, date, description, URL, hostname,
  sitename, categories, tags, image, license, and `declaredPageType` fields, or `None`.
- `declared_page_type` — the same page declaration exposed as a convenience attribute.
  OpenGraph values remain raw; recognized JSON-LD types come from the pinned upstream.
  This is descriptive metadata and does not select an extraction strategy.

Async callers use the same options:

```python
import asyncio
from trafilaturacore import aclean


async def main():
    result = await aclean("<article><p>Supplied article content.</p></article>")
    print(result.html)


asyncio.run(main())
```

`aclean()` runs cleaning in a worker thread. Cancelling the await does not stop an already
running worker. Callers needing hard deadlines should provide process isolation.

## Options

| Option             | Values and behavior                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `boilerplate`      | `"precision"`, `"balanced"` (default), `"recall"`, or `"keep"`; keep skips extraction    |
| `image_handling`   | `"include"` (default), `"exclude"`, `"alt-text"`, or `"resolved-url"`                    |
| `link_handling`    | `"include"` (default) or `"exclude"`; exclusion retains anchor text                      |
| `table_handling`   | `"include"` (default) or `"exclude"`; exclusion removes table content                    |
| `comment_handling` | `"include"` (default) or `"exclude"`; exclusion removes detected user-comment containers |
| `url`              | Absolute HTTP(S) URL used only for metadata and relative-image resolution                |
| `config`           | Validated cleaning dictionary described below                                            |
| `max_input_bytes`  | Positive UTF-8 byte limit, default 10 MiB; the native hard ceiling is 64 MiB             |

All modes pass through cleaning. Empty or failed extraction falls back to whole-document
cleaning with a diagnostic. Deterministic resource failures reject instead of falling back.
Invalid types/options raise `TypeError` or `ValueError`; resource failures raise
`ResourceLimitError`, a `TrafilaturacoreError` subclass whose `code` is
`ERR_TRAFILATURACORE_RESOURCE_LIMIT`. The former subprocess `timeout` option, runtime
environment variables, and `NodeRuntimeError` are absent.

Image `"alt-text"` produces src-less image placeholders, using alt text, a single-image
figure's caption, ARIA text, then title. Explicit empty alt text removes decorative images.
`"resolved-url"` promotes lazy URLs, selects srcset candidates when needed, and resolves
against `url` or the document's absolute base URL. Extraction can discard attributes before
these transforms run; `"keep"` retains the original image context.

## Custom cleaning

Dictionary keys use the same JSON vocabulary as TypeScript:

```python
from trafilaturacore import clean

result = clean(
    "<section><p class='note'>Text <b>in bold</b>.</p></section>",
    boilerplate="keep",
    config={
        "allowedTags": ["p", "strong"],
        "allowedAttributes": {"p": ["class"]},
        "allowedClasses": {"p": ["note"]},
        "transformTags": {"b": "strong"},
    },
)
```

Supported keys are `allowedTags`, `allowedAttributes`, `allowedClasses`, `nonTextTags`,
`transformTags`, and `selfClosing`. Supplied fields replace their native defaults; omitted
fields keep them. Class and attribute allowlists accept shell-style wildcard patterns.
`selfClosing` accepts standard HTML void tags only; custom XML-style void elements raise
`ValueError`.

Custom policies still remove scripts, embedding elements, SVG/MathML, stylesheet elements,
event handlers, refresh metadata, and disallowed URL schemes. Inline styles retain a limited
set of presentation properties; declarations containing CSS URLs, expressions, comments, or
escapes are removed. Remote HTTP(S) links and images can remain in the result.

## Language differences

The libraries share extraction focus and content controls, not byte-identical serialization.
Python returns an lxml/nh3-normalized fragment; TypeScript uses parse5 and sanitize-html and
can retain document scaffolding. Malformed HTML recovery, native custom-config defaults,
CSS preservation, diagnostics, and resource ceilings can differ. Python's
date extraction recognizes additional date formats; URL cleanup and domain handling follow
Courlan. Python also cleans metadata image strings and retains its first raw OpenGraph type
declaration. These adapters preserve the existing native API.

Python's conservative preflight limits nesting to 128 levels, 100,000 source nodes, 256 attributes per tag,
200,000 aggregate attributes, and 50,000 expanded table cells. Intermediate/output HTML is
limited to 32 MiB. JSON parser exhaustion raises a resource error.

Report problems through the
[issue tracker](https://github.com/markdownee/trafilaturacore/issues).

## Acknowledgements

- [Trafilatura](https://github.com/adbar/trafilatura) — original Python implementation by Adrien Barbaresi.
- [go-trafilatura](https://github.com/markusmobius/go-trafilatura) — Go port by Markus Mobius, used as a DOM translation aid.

Licensed under [Apache-2.0](https://github.com/markdownee/trafilaturacore/blob/main/LICENSE).
See the compact [third-party notices](https://github.com/markdownee/trafilaturacore/blob/main/THIRD-PARTY-NOTICES.txt).
