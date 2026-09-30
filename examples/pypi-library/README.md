# Trafilatura Core Python examples

These programs clean the supplied [sample HTML](../sample.html) _without fetching
a page_. `main.py` demonstrates extraction modes, content controls, metadata,
custom cleaning, and input limits. `async_example.py` runs `aclean()` across the
four modes.

## Run the examples

Use Python 3.10 or newer. From this directory in a downloaded or cloned
[repository](https://github.com/markdownee/trafilaturacore), run:

```bash
pip install trafilaturacore
python main.py
python async_example.py
```

Both programs print results to the terminal: cleaned HTML lengths, available
metadata, and checks of the selected controls. They do not write cleaned files.

## Test the local package

With `uv` and Python 3.12 available, run from this directory:

```bash
./run.sh
```

The runner builds a wheel and source archive in a temporary directory, installs
the wheel in a fresh environment, and executes both programs. It prints the
artifact directory; dependencies are downloaded during setup.

The [Python guide](https://www.trafilaturacore.com/help/pypi/) covers the supported
API and its differences from TypeScript. Python provides library APIs only.
