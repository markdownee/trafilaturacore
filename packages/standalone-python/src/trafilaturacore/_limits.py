# SPDX-License-Identifier: Apache-2.0
"""Resource validation before metadata extraction or DOM construction."""

from __future__ import annotations

import re
from html.parser import HTMLParser

from lxml import etree
from lxml.html import HTMLParser as NativeHTMLParser

from ._errors import ResourceLimitError

MAX_INPUT_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 32 * 1024 * 1024
MAX_NODES = 100_000
MAX_DEPTH = 128
MAX_TAG_BYTES = 65_536
MAX_ATTRIBUTES = 256
MAX_TOTAL_ATTRIBUTES = 200_000
MAX_TABLE_CELLS = 50_000


def _lexical_width(source: str) -> None:
    """Bound lexical tag buffers before either tokenizer creates attributes."""
    cursor = 0
    while (start := source.find("<", cursor)) >= 0:
        cursor = start + 1
        width = 1
        quote: str | None = None
        while cursor < len(source):
            char = source[cursor]
            width += len(char.encode("utf-8"))
            if width > MAX_TAG_BYTES:
                raise ResourceLimitError("source tag exceeds the width limit")
            cursor += 1
            if quote is not None:
                if char == quote:
                    quote = None
            elif char in {"'", '"'}:
                quote = char
            elif char == ">":
                break


class _SourceLexer(HTMLParser):
    """Count source work, including duplicate attributes, without creating a DOM."""

    CDATA_CONTENT_ELEMENTS = (
        "script",
        "style",
        "xmp",
        "textarea",
        "title",
        "iframe",
        "noembed",
        "noframes",
        "plaintext",
    )

    def __init__(self, nulls: int = 0) -> None:
        """Initialize the native source budgets."""
        super().__init__(convert_charrefs=False)
        self.nodes = nulls
        self.attributes = 0
        self.table_cells = 0
        self.text_run = False

    def _node(self) -> None:
        """Charge one source structure/text run."""
        self.nodes += 1
        if self.nodes > MAX_NODES:
            raise ResourceLimitError("source node limit exceeded")

    def set_cdata_mode(self, elem: str, *, escapable: bool = False) -> None:
        """Match libxml's raw names and permissive end-tag syntax."""
        super().set_cdata_mode(elem)
        if hasattr(self, "_escapable"):
            self._escapable = escapable
        self.interesting = (
            re.compile(r"(?!x)x")
            if elem == "plaintext"
            else re.compile(r"</\s*" + re.escape(elem) + r"(?=[\s/>])", re.IGNORECASE | re.ASCII)
        )

    def parse_endtag(self, position: int) -> int:
        """Let the standard lexer consume libxml-style raw end tags with attributes."""
        if self.cdata_elem is not None and self.rawdata.find(">", position) >= 0:
            self.clear_cdata_mode()
        return super().parse_endtag(position)

    def parse_marked_section(self, position: int, report: int = 1) -> int:
        """Native HTML treats CDATA-like declarations as bogus comments, not XML CDATA."""
        return self.parse_bogus_comment(position)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Bound attributes before the native target-parser pass."""
        self.text_run = False
        self._node()
        self.attributes += len(attrs)
        if len(attrs) > MAX_ATTRIBUTES or self.attributes > MAX_TOTAL_ATTRIBUTES:
            raise ResourceLimitError("source attribute limit exceeded")
        if tag in {"td", "th"}:
            attributes: dict[str, str | None] = {}
            for name, value in attrs:
                attributes.setdefault(name, value)
            area = 1
            for name in ("colspan", "rowspan"):
                value = attributes.get(name) or "1"
                if re.fullmatch(r"[0-9]{1,4}", value) is None or int(value) > 1000:
                    raise ResourceLimitError("table span limit exceeded")
                area *= max(1, int(value))
            self.table_cells += area
            if self.table_cells > MAX_TABLE_CELLS:
                raise ResourceLimitError("table expansion limit exceeded")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Count self-closing source tokens conservatively, as the native contract did."""
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        """Close a text run; the native target owns actual nesting semantics."""
        self.text_run = False

    def handle_data(self, data: str) -> None:
        """Count one text run without materializing text nodes."""
        if data and not self.text_run:
            self._node()
            self.text_run = True

    def handle_entityref(self, name: str) -> None:
        """References are part of a text run."""
        self.handle_data("&")

    def handle_charref(self, name: str) -> None:
        """Numeric references are part of a text run."""
        self.handle_data("&")

    def handle_comment(self, data: str) -> None:
        """Charge comment structures even though the DOM parser later removes them."""
        self.text_run = False
        self._node()

    def handle_decl(self, decl: str) -> None:
        """Charge declarations."""
        self.text_run = False
        self._node()

    def handle_pi(self, data: str) -> None:
        """Charge processing-instruction structures."""
        self.text_run = False
        self._node()


class _NativeTarget:
    """Validate native recovery events while retaining no elements, attributes or text."""

    def __init__(self) -> None:
        """Measure recovered depth from the same zero-based root as the DOM guard."""
        self.depth = -1
        self.nodes = 0

    def start(self, tag: str, attrs: dict[str, str]) -> None:
        """Reject a recovered element before a document builder could create it."""
        self.depth += 1
        self.nodes += 1
        if self.depth > MAX_DEPTH:
            raise ResourceLimitError("source depth limit exceeded")
        if self.nodes > MAX_NODES:
            raise ResourceLimitError("source node limit exceeded")
        if len(attrs) > MAX_ATTRIBUTES:
            raise ResourceLimitError("source attribute limit exceeded")

    def end(self, tag: str) -> None:
        """Follow the native parser's actual implicit and explicit closures."""
        self.depth -= 1

    def data(self, data: str) -> None:
        """Discard text immediately; the lexical pass already counted source work."""

    def close(self) -> None:
        """Return no document or retained parse product."""


def preflight(html: str | bytes, max_input_bytes: int) -> str:
    """Validate source work and recovered nesting before constructing any document."""
    if not isinstance(html, (str, bytes)):
        raise TypeError("html must be str or UTF-8 bytes")
    if type(max_input_bytes) is not int or max_input_bytes <= 0:
        raise ValueError("max_input_bytes must be a positive integer")
    encoded = html if isinstance(html, bytes) else html.encode("utf-8")
    if len(encoded) > min(max_input_bytes, MAX_INPUT_BYTES):
        raise ResourceLimitError("input exceeds the UTF-8 byte limit")
    source = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    nulls = source.count("\x00")
    if nulls > MAX_NODES:
        raise ResourceLimitError("source node limit exceeded")
    _lexical_width(source)
    lexer = _SourceLexer(nulls)
    # Native HTML replaces NUL inside names. Deleting it could invent a raw-text
    # tag and conceal later markup; the replacement keeps token boundaries visible.
    lexer.feed(source.replace("\x00", "\ufffd") if nulls else source)
    lexer.close()
    if not source.strip():
        return source
    parser = NativeHTMLParser(
        target=_NativeTarget(),
        encoding="utf-8",
        no_network=True,
        recover=True,
        remove_comments=True,
        remove_pis=True,
        huge_tree=False,
    )
    try:
        etree.fromstring(source.encode("utf-8"), parser=parser)
    except ResourceLimitError:
        raise
    except etree.Error as error:
        raise ValueError("input cannot be parsed as HTML") from error
    return source


def bound_output(html: str) -> str:
    """Apply the native cumulative output-byte ceiling."""
    if len(html.encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise ResourceLimitError("output exceeds the UTF-8 byte limit")
    return html
