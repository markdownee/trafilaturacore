"""Async example: clean several pages concurrently with ``aclean``.

``aclean`` runs the same native Python cleaning pipeline in a worker thread.
It accepts supplied HTML and does not fetch resources.

Run:  python async_example.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import trafilaturacore

SAMPLE = Path(__file__).resolve().parents[1] / "sample.html"


async def main() -> None:
    """Run native cleaning for each boilerplate mode through the async API."""
    html = SAMPLE.read_text(encoding="utf-8")

    # Run the four boilerplate modes concurrently.
    results = await asyncio.gather(
        *(
            trafilaturacore.aclean(html, boilerplate=mode)
            for mode in trafilaturacore.BOILERPLATE_MODES
        )
    )
    for mode, result in zip(trafilaturacore.BOILERPLATE_MODES, results, strict=True):
        print(f"{mode}: {len(result.html)} chars")

    # A byte limit rejects oversized input before parsing.
    bounded = await trafilaturacore.aclean(html, max_input_bytes=100_000)
    print("balanced title:", None if bounded.metadata is None else bounded.metadata.get("title"))


if __name__ == "__main__":
    asyncio.run(main())
