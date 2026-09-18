"""Sync example: clean a page's main content from Python.

The native Python library translates the primary TypeScript extraction engine,
using lxml and nh3 adapters. It does not fetch the page or call a Node product engine.

Run:  python main.py
"""

from __future__ import annotations

from pathlib import Path

import trafilaturacore

SAMPLE = Path(__file__).resolve().parents[1] / "sample.html"


def main() -> None:
    """Show native extraction, content handling, metadata, and validation."""
    html = SAMPLE.read_text(encoding="utf-8")

    print("version:", trafilaturacore.__version__)
    print("modes:", list(trafilaturacore.BOILERPLATE_MODES))
    print("default mode:", trafilaturacore.DEFAULT_BOILERPLATE_MODE)

    # The simplest call: defaults to `balanced` and keeps comments/tables/
    # images/links. Boilerplate (nav, sidebar, footer) is dropped.
    result = trafilaturacore.clean(html)
    print("cleaned html length:", len(result.html))
    if result.metadata is not None:
        # `metadata` is a dictionary; field names follow the product contract.
        meta = result.metadata
        print("title:", meta.get("title"), "| author:", meta.get("author"))
    for message in result.messages:
        print(f"[{message.type}] {message.text}")

    # The four boilerplate modes. `keep` skips main-content extraction entirely
    # (HTML cleanup only).
    for mode in trafilaturacore.BOILERPLATE_MODES:
        r = trafilaturacore.clean(html, boilerplate=mode)
        print(f"{mode}: {len(r.html)} chars")

    # Content-handling modes are snake_case keyword arguments; each defaults to
    # "include", and "exclude" subtracts that content family. Comment exclusion
    # removes structurally detected user-comment sections. Images also support
    # "alt-text" and "resolved-url".
    lean = trafilaturacore.clean(
        html,
        image_handling="exclude",
        link_handling="exclude",
        table_handling="exclude",
        comment_handling="exclude",
    )
    print("lean has <img>?", "<img" in lean.html)
    print("lean has <a href>?", "<a href" in lean.html)

    # `url` is context only (metadata + image-URL resolution) — NEVER fetched.
    with_url = trafilaturacore.clean(html, url="https://example.com/blog/post")
    if with_url.metadata is not None:
        print("metadata url:", with_url.metadata.get("url"))

    # Supplied config fields replace native defaults; omitted fields retain them.
    # The cleaning stage removes scripts, event handlers, and dangerous URL schemes.
    custom = trafilaturacore.clean(
        html,
        config={
            "allowedTags": ["h1", "h2", "p", "a", "strong", "em"],
            "allowedAttributes": {"a": ["href"]},
        },
    )
    print("custom-config length:", len(custom.html))

    # Boundary guards raise rather than silently degrading.
    try:
        trafilaturacore.clean(html, max_input_bytes=10)
    except trafilaturacore.TrafilaturacoreError as error:
        print("oversized input rejected:", type(error).__name__)


if __name__ == "__main__":
    main()
