# SPDX-License-Identifier: Apache-2.0
# Author normalization derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/json_metadata.py::normalize_authors and AUTHOR_* vocabulary
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/json_metadata.py
#   trafilatura/metadata.py::check_authors
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted Unicode casing, forward-only nickname scanning and author-count limits.
"""Bounded author normalization from the primary TypeScript implementation."""

from __future__ import annotations

import re
from collections.abc import Set

from ._metadata_text import strip_html_tags
from ._settings import MAX_AUTHOR_NAMES
from ._unicode import DECIMAL_CLASS, WORD_CLASS, first_is_upper, title
from ._utils import PY_SPACE_CLASS, html_unescape, trim

_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![" + WORD_CLASS + "])")
_SPLIT = re.compile(
    r"/|;|,|\||&|(?:^|[^" + WORD_CLASS + r"])[uUaA][nN][dD](?:$|[^" + WORD_CLASS + "])"
)
_TWITTER = re.compile("@[" + WORD_CLASS + "]+")
_SPECIAL = re.compile("[^" + WORD_CLASS + r"]+$|[:()?*$#!%/<>{}~¿]")
_NUMBERS = re.compile("[" + DECIMAL_CLASS + r"][\s\S]+?$")
_EMOJI = re.compile(
    "[\u2700-\u27be\U0001f600-\U0001f64f\u2600-\u26ff\U0001f300-\U0001f5ff"
    "\U0001f900-\U0001f9ff\U0001fa70-\U0001faff\U0001f680-\U0001f6ff]+"
)
_OPENERS = frozenset(('"', "‘", "(", "{", "[", "’", "'"))
_CLOSERS = frozenset(("‘", "’", '"', "'", ")", "]", "}"))


def _ascii_word(value: str) -> str:
    """Expand ASCII case explicitly without widening pinned Unicode word classes."""
    return "".join(
        "[" + char + char.upper() + "]" if "a" <= char <= "z" else re.escape(char) for char in value
    )


_PREFIX = re.compile(
    r"^([a-zA-ZäÄöÖüÜß]+(?:[eE][dD]|[tT]))? ?(?:"
    + "|".join(
        _ascii_word(word) for word in ("written by", "words by", "words", "by", "von", "from")
    )
    + ") "
)
_PREPOSITION = re.compile(
    "(?<=["
    + WORD_CLASS
    + "])["
    + PY_SPACE_CLASS
    + "]+(?:"
    + "|".join(
        _ascii_word(word)
        for word in ("am", "on", "for", "at", "in", "to", "from", "of", "via", "with")
    )
    + "|—|-|–)["
    + PY_SPACE_CLASS
    + r"]+([\s\S]*)"
)


def remove_nicknames(value: str) -> str:
    """Implement the source's lazy nickname rule with two forward cursors."""
    result = []
    copied = closing = position = 0
    while position < len(value):
        if (
            value[position] not in _OPENERS
            or position + 1 >= len(value)
            or value[position + 1] == '"'
        ):
            position += 1
            continue
        closing = max(closing, position + 2)
        while closing < len(value) and value[closing] not in _CLOSERS:
            closing += 1
        if closing == len(value):
            break
        if position > copied:
            result.append(value[copied:position])
        position = closing + 1
        copied = position
    result.append(value[copied:])
    return "".join(result)


def normalize_authors(current: str | None, author_string: str) -> str | None:
    """Merge and normalize author names while bounding the quadratic fullness check."""
    if author_string.lower().startswith("http") or _EMAIL.search(author_string):
        return current
    source = author_string
    if r"\u" in source:
        source = re.sub(r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match[1], 16)), source)
        source = source.encode("utf-16-le", errors="surrogatepass").decode(
            "utf-16-le", errors="surrogatepass"
        )
    if "&#" in source or "&amp;" in source:
        source = html_unescape(source)
    names = current.split("; ") if current else []
    known = set(names)
    before = len(names)
    for part in _SPLIT.split(strip_html_tags(source)):
        if len(names) >= MAX_AUTHOR_NAMES:
            break
        name = _TWITTER.sub("", _EMOJI.sub("", trim(part)))
        name = remove_nicknames(trim(re.sub(r"[._+]", " ", name)))
        name = _PREPOSITION.sub("", _NUMBERS.sub("", _PREFIX.sub("", _SPECIAL.sub("", name))))
        if not name or len(name) >= 50 and " " not in name and "-" not in name:
            continue
        if not first_is_upper(name):
            name = title(name)
        if name not in known:
            known.add(name)
            names.append(name)
    if len(names) == before and len(names) >= MAX_AUTHOR_NAMES:
        return current
    fullest = [
        name for name in names if not any(other != name and name in other for other in names)
    ]
    return "; ".join(fullest).strip("; ") if fullest else current


def check_authors(authors: str, blacklist: Set[str]) -> str | None:
    """Remove denied author names after trimming."""
    denied = {name.lower() for name in blacklist}
    kept = [
        name for item in authors.split(";") if (name := item.strip()) and name.lower() not in denied
    ]
    return "; ".join(kept).strip("; ") if kept else None
