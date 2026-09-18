# SPDX-License-Identifier: Apache-2.0
# Metadata text handling derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/utils.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/utils.py
#   trafilatura/json_metadata.py::normalize_json
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/json_metadata.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted string/entity operations, conditional decoding and Unicode filtering.
"""Metadata text cleanup translated from the frozen primary source."""

from __future__ import annotations

import re

from ._utils import html_unescape, remove_control_characters, trim


def strip_html_tags(value: str) -> str:
    """Apply the primary metadata tag-removal expression."""
    return re.sub(r"<!--.*?-->|<[^>]*>", "", value)


def normalize_json(value: str) -> str:
    """Decode escaped JSON metadata using the source's conditional entity pass."""
    if "\\" in value:
        value = re.sub(r"\\[nrt]", "", value)

        def unicode_escape(match: re.Match[str]) -> str:
            """Discard escaped surrogate code units as the primary adapter does."""
            point = int(match[1], 16)
            return "" if 0xD800 <= point <= 0xDFFF else chr(point)

        value = re.sub(r"\\u([0-9a-fA-F]{4})", unicode_escape, value)
        value = html_unescape("".join(char for char in value if not 0xD800 <= ord(char) <= 0xDFFF))
    return trim(strip_html_tags(value))


def line_processing(value: str) -> str | None:
    """Expand the designated references and filter/normalize one metadata line."""
    expanded = value.replace("&#13;", "\r").replace("&#10;", "\n").replace("&nbsp;", "\u00a0")
    return trim(remove_control_characters(expanded)) or None


def string_value(value: object) -> str | None:
    """Narrow a JSON/metadata scalar without coercing arrays or objects."""
    return value if isinstance(value, str) else None
