# Trafilatura Core — PyPI library example

Shows the native Python library's public API: the sync `clean()` and the async
`aclean()`, the four boilerplate modes, the image, link, table, and user-comment
handling modes, a custom JSON cleaning config, and the boundary guards.

TypeScript is the primary implementation. The maintained Python library translates
that engine and uses native lxml/nh3 adapters to process supplied HTML. It provides no product
CLI and bundles no Node product engine. Dependencies install separately.

The Python API and serialization can differ from the TypeScript implementation.

## Install the native version

Install the matching native release when it is available:

```bash
pip install trafilaturacore==0.8.1
python main.py
python async_example.py
```

## Run against this checkout (unreleased changes)

`./run.sh` stages the legal files in a disposable candidate, builds a
`py3-none-any` wheel and source archive, installs the wheel into a fresh virtual
environment, and runs both example scripts. It requires `uv` and Python 3.12;
the library itself supports Python 3.10 or newer. It downloads Python build and
runtime dependencies but needs no Node.js build or browser setup.

```bash
./run.sh
```

The runner prints the temporary artifact directory. Its wheel can also be passed
to the Markdownee example runner to test both native libraries together.

The [package README](../../packages/standalone-python/README.md) describes the
supported options and differences from the TypeScript API.
