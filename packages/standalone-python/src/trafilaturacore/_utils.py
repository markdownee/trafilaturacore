# SPDX-License-Identifier: Apache-2.0
# Text, image and filtering helpers derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/utils.py (text, image and filtering helpers)
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/utils.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Unicode data provenance is recorded in _unicode.py.
# Modified: adapted string/entity handling with bounded image and leading-word scans.
"""Whitespace, Unicode text filtering and image recognition for extraction."""

from __future__ import annotations

import re
from html import unescape

from ._tree import Tree
from ._unicode import is_rejected, is_word

PY_SPACE_CLASS = (
    r"\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000"
)
_SPACE_RUN = re.compile("[" + PY_SPACE_CLASS + "]+")
PY_SPACE_CHARS = (
    "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
_SHARE_LINE = re.compile(
    (
        "^(?:Drucken|E-?Mail|Facebook|Flipboard|Google|Instagram"
        "|Linkedin|Mail|PDF|Pinterest|Pocket|Print|QQ|Reddit|Twi"
        "tter|WeChat|WeiBo|Whatsapp|Xing|Mehr zum Thema:?|More o"
        "n this.{0,8})$"
    ),
    re.IGNORECASE | re.ASCII,
)
_IMAGE = re.compile(r"\.(?:avif|bmp|gif|hei[cf]|jpe?g|png|webp)", re.IGNORECASE | re.ASCII)
FORMATTING_PROTECTED = frozenset(("cell", "head", "hi", "item", "p", "quote", "ref", "td"))
LINK_FARM_RATIO = 0.9


def strip_space(value: str) -> str:
    """Strip the explicit pinned whitespace set."""
    return value.strip(PY_SPACE_CHARS)


def trim(value: str) -> str:
    """Collapse runs of pinned whitespace after trimming."""
    return _SPACE_RUN.sub(" ", strip_space(value))


def trim_or_none(value: str | None) -> str | None:
    """Return normalized text or the missing-value marker."""
    return trim(value or "") or None


def text_chars_test(value: str | None) -> bool:
    """Require at least one non-whitespace character."""
    return bool(value and strip_space(value))


def textfilter(tree: Tree, identifier: int) -> bool:
    """Reject empty text and pinned sharing boilerplate."""
    own = tree.text(identifier)
    value = tree.tail(identifier) if own is None else own
    if not text_chars_test(value):
        return True
    for line in (value or "").splitlines():
        start = next((index for index, char in enumerate(line) if is_word(ord(char))), len(line))
        candidate = line[start:].replace("\u017f", "s").replace("\u212a", "k")
        if _SHARE_LINE.fullmatch(candidate):
            return True
    return False


def remove_control_characters(value: str) -> str:
    """Filter using the frozen Unicode table, independent of Python version."""
    return "".join(char for char in value if not is_rejected(ord(char)))


def html_unescape(value: str) -> str:
    """Use Python's HTML5 reference handling, which the primary adapter emulates."""
    return unescape(value)


def is_image_file(source: str | None) -> bool:
    """Check bounded extension candidates and pinned Unicode word boundaries."""
    if source is None or len(source) > 8192:
        return False
    for candidate in _IMAGE.finditer(source):
        if candidate.start() == 0 or source[candidate.start() - 1].isspace():
            continue
        if candidate.end() == len(source) or not is_word(ord(source[candidate.end()])):
            return True
    return False


def is_image_element(tree: Tree, identifier: int) -> bool:
    """Recognize canonical and lazy source attributes in their retained order."""
    if is_image_file(tree.get(identifier, "data-src")) or is_image_file(
        tree.get(identifier, "src")
    ):
        return True
    return any(
        name.startswith("data-src") and is_image_file(value)
        for name, value in tree.node(identifier).attrs.items()
    )
