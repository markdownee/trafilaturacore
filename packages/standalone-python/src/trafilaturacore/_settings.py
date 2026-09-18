# SPDX-License-Identifier: Apache-2.0
# Extraction settings derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/settings.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/settings.py
#   trafilatura/settings.cfg
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/settings.cfg
#   trafilatura/core.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/core.py
#   trafilatura/baseline.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/baseline.py
#   trafilatura/htmlprocessing.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/htmlprocessing.py
#   trafilatura/main_extractor.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/main_extractor.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted extraction constants and added separate product resource limits.
"""Extraction constants translated from the frozen primary implementation."""

from __future__ import annotations

BLOCK_ELEMS = frozenset(
    (
        "address",
        "article",
        "aside",
        "blockquote",
        "br",
        "dd",
        "div",
        "dl",
        "dt",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "summary",
        "table",
        "td",
        "th",
        "tr",
        "ul",
    )
)
COOKIE_CONSENT_RE = (
    "cookie[-_]?(?:banner|bar|consent|law|notice|policy|desc"
    "ription)|notice[-_]{0,2}cookie|consent[-_]?(?:banner|ma"
    "nager|sdk)|borlabs|cookiebot|cmplz|onetrust|moove[-_]?g"
    "dpr"
)
CUT_EMPTY_ELEMS = frozenset(
    (
        "article",
        "b",
        "blockquote",
        "dd",
        "div",
        "dt",
        "em",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "i",
        "li",
        "main",
        "p",
        "pre",
        "q",
        "section",
        "span",
        "strong",
    )
)
DEDUPE_SCAN_CAP = 200000
ESCALATION_ACCEPT_RATIO = 1.5
ESCALATION_MAX_LENGTH = 3000
ESCALATION_PAGE_SHARE = 0.2
FORUM_SALVAGE_SCAN_BYTES = 16777216
INLINE_CARRIED = frozenset(
    (
        "code",
        "del",
        "graphic",
        "hi",
        "ref",
    )
)
INLINE_CONSUMING = (
    "del",
    "hi",
    "ref",
)
INLINE_FORMATTABLE = (
    "code",
    "del",
    "hi",
    "ref",
)
MANUALLY_CLEANED = (
    "aside",
    "embed",
    "fencedframe",
    "footer",
    "form",
    "head",
    "iframe",
    "menu",
    "object",
    "script",
    "applet",
    "audio",
    "canvas",
    "figure",
    "map",
    "picture",
    "svg",
    "video",
    "area",
    "blink",
    "button",
    "datalist",
    "dialog",
    "frame",
    "frameset",
    "fieldset",
    "link",
    "input",
    "ins",
    "label",
    "legend",
    "marquee",
    "math",
    "menuitem",
    "nav",
    "noindex",
    "noscript",
    "optgroup",
    "option",
    "output",
    "param",
    "progress",
    "rp",
    "rt",
    "rtc",
    "select",
    "source",
    "style",
    "track",
    "textarea",
    "time",
    "use",
)
MANUALLY_STRIPPED = (
    "abbr",
    "acronym",
    "address",
    "bdi",
    "bdo",
    "big",
    "cite",
    "data",
    "dfn",
    "font",
    "hgroup",
    "img",
    "ins",
    "mark",
    "meta",
    "nobr",
    "ruby",
    "small",
    "tbody",
    "template",
    "tfoot",
    "thead",
)
MAX_ARENA_NODES = 1048576
MAX_ARENA_STRING_BYTES = 67108864
MAX_ATTRIBUTES_PER_TAG = 1024
MAX_ATTRIBUTE_SCAN_COMPARISONS = 10000000
MAX_AUTHOR_NAMES = 250
MAX_INPUT_BYTES = 33554432
MAX_JSON_AUTHOR_FALLBACK_UNITS = 65536
MAX_JSON_AUTHOR_RESCAN_UNITS = 4194304
MAX_OUTPUT_BYTES = 16777216
MAX_SOURCE_NODES = 262144
MAX_SPAN = 100
MAX_STRIP_VISITS = 16777216
MAX_TREE_DEPTH = 512
MIN_CONTENT_LENGTH = 100
MIN_DUPLICATE_LENGTH = 50
MIN_EXTRACTED_COMM_SIZE = 1
MIN_EXTRACTED_SIZE = 250
MIN_OUTPUT_COMM_SIZE = 1
MIN_OUTPUT_SIZE = 1
PRESERVE_IMG_CLEANING = (
    "figure",
    "picture",
    "source",
)
TABLE_CELL_BUDGET = 65536
TAG_CATALOG = (
    "blockquote",
    "code",
    "del",
    "head",
    "hi",
    "lb",
    "list",
    "p",
    "pre",
    "quote",
)
