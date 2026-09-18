# SPDX-License-Identifier: Apache-2.0
"""The primary metadata layer's closed CSS grammar over native lxml elements."""

from __future__ import annotations

import re
from dataclasses import dataclass

from lxml.html import HtmlElement

_INSENSITIVE = frozenset(
    [
        "accept",
        "accept-charset",
        "align",
        "alink",
        "axis",
        "bgcolor",
        "charset",
        "checked",
        "clear",
        "codetype",
        "color",
        "compact",
        "declare",
        "defer",
        "dir",
        "direction",
        "disabled",
        "enctype",
        "face",
        "frame",
        "hreflang",
        "http-equiv",
        "lang",
        "language",
        "link",
        "media",
        "method",
        "multiple",
        "nohref",
        "noresize",
        "noshade",
        "nowrap",
        "readonly",
        "rel",
        "rev",
        "rules",
        "scope",
        "scrolling",
        "selected",
        "shape",
        "target",
        "text",
        "type",
        "valign",
        "valuetype",
        "vlink",
    ]
)
_ASCII_CASE = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
_CACHE: dict[str, tuple[tuple[Compound, ...], ...]] = {}


def ascii_lower(value: str) -> str:
    """Fold ASCII letters without altering foreign identifiers."""
    return value.translate(_ASCII_CASE)


def _space(value: str) -> bool:
    """Recognize the CSS ASCII whitespace vocabulary."""
    return bool(value) and value in " \t\n\r\f"


def _identifier(value: str) -> bool:
    """Recognize one character from the primary adapter's identifier grammar."""
    return bool(value) and (
        value.isascii() and (value.isalnum() or value in "_-") or ord(value) >= 128
    )


@dataclass(frozen=True)
class Condition:
    """One attribute predicate with an optional case flag."""

    name: str
    value: str = ""
    operator: str = "exists"
    flag: str | None = None


@dataclass(frozen=True)
class Compound:
    """A type/id/attribute compound without combinators."""

    tag: str | None
    ids: tuple[str, ...]
    attributes: tuple[Condition, ...]


class Reader:
    """A forward-only parser for the bounded metadata selector grammar."""

    def __init__(self, source: str) -> None:
        """Replace invalid scalar values before reading the selector."""
        self.original = source
        self.text = "".join(
            "\ufffd" if ord(char) == 0 or 0xD800 <= ord(char) <= 0xDFFF else char for char in source
        )
        self.offset = 0

    @property
    def current(self) -> str:
        """Read the current character or end marker."""
        return self.text[self.offset : self.offset + 1]

    def fail(self, message: str) -> None:
        """Reject unsupported syntax rather than silently broadening selection."""
        raise ValueError(f"{message} (in selector {self.original!r})")

    def spaces(self) -> bool:
        """Consume whitespace and report whether a descendant separator occurred."""
        before = self.offset
        while _space(self.current):
            self.offset += 1
        return self.offset != before

    def escape(self) -> str:
        """Decode a CSS escaped character or at most six hexadecimal digits."""
        self.offset += 1
        if self.offset == len(self.text):
            self.fail("trailing backslash")
        digits = re.match(r"[0-9a-fA-F]{1,6}", self.text[self.offset : self.offset + 6])
        if digits is None:
            value = self.current
            self.offset += 1
            return value
        self.offset += len(digits[0])
        if _space(self.current):
            self.offset += 1
        point = int(digits[0], 16)
        return (
            "\ufffd" if point == 0 or point > 0x10FFFF or 0xD800 <= point <= 0xDFFF else chr(point)
        )

    def word(self) -> str:
        """Consume an escaped or literal identifier."""
        result = []
        while self.offset < len(self.text):
            if self.current == "\\":
                result.append(self.escape())
            elif _identifier(self.current):
                result.append(self.current)
                self.offset += 1
            else:
                break
        if not result:
            self.fail("expected identifier")
        return "".join(result)

    def value(self) -> str:
        """Read an identifier or quoted attribute value."""
        quote = self.current
        if quote not in {'"', "'"}:
            return self.word()
        self.offset += 1
        result = []
        while self.offset < len(self.text):
            if self.current == quote:
                self.offset += 1
                return "".join(result)
            if self.current == "\\":
                result.append(self.escape())
            else:
                if self.current == "\n":
                    self.fail("newline inside a selector string")
                result.append(self.current)
                self.offset += 1
        self.fail("unterminated string")
        return ""

    def attribute(self) -> Condition:
        """Read one existence or value condition."""
        self.offset += 1
        self.spaces()
        name = self.word()
        self.spaces()
        operator, value, flag = "exists", "", None
        if self.current != "]":
            pair = self.text[self.offset : self.offset + 2]
            if pair in {"^=", "$=", "*=", "~=", "|="}:
                operator = pair
                self.offset += 2
            else:
                if self.current != "=":
                    self.fail("unsupported attribute operator")
                operator = "="
                self.offset += 1
            self.spaces()
            value = self.value()
            self.spaces()
            marker = ascii_lower(self.current)
            if marker in {"i", "s"}:
                flag = marker
                self.offset += 1
                self.spaces()
        if self.current != "]":
            self.fail("unterminated attribute selector")
        self.offset += 1
        return Condition(name, value, operator, flag)

    def compound(self) -> Compound:
        """Read one type/id/attribute compound."""
        tag = None
        universal = self.current == "*"
        if universal:
            self.offset += 1
        elif self.current and self.current != "-" and _identifier(self.current):
            tag = self.word()
        ids, attributes = [], []
        while True:
            if self.current == "#":
                self.offset += 1
                ids.append(self.word())
            elif self.current == "[":
                attributes.append(self.attribute())
            elif self.current in {".", ":", "|"}:
                self.fail("unsupported compound selector syntax")
            else:
                break
        if tag is None and not universal and not ids and not attributes:
            self.fail("empty compound selector")
        return Compound(tag, tuple(ids), tuple(attributes))

    def parse(self) -> tuple[tuple[Compound, ...], ...]:
        """Parse a selector list with descendant combinators only."""
        self.spaces()
        if not self.current:
            self.fail("empty selector")
        result = []
        compounds = []
        while self.offset < len(self.text):
            compounds.append(self.compound())
            separated = self.spaces()
            if not self.current:
                break
            if self.current == ",":
                result.append(tuple(compounds))
                compounds = []
                self.offset += 1
                self.spaces()
                if not self.current:
                    self.fail("trailing comma")
            elif not separated or self.current in {">", "+", "~"}:
                self.fail("unsupported combinator or trailing syntax")
        result.append(tuple(compounds))
        return tuple(result)


def compile_selector_list(source: str) -> tuple[tuple[Compound, ...], ...]:
    """Cache a bounded number of compiled selectors in insertion order."""
    if source in _CACHE:
        return _CACHE[source]
    selectors = Reader(source).parse()
    if len(_CACHE) >= 256:
        del _CACHE[next(iter(_CACHE))]
    _CACHE[source] = selectors
    return selectors


def _matches_value(condition: Condition, value: str, html: bool) -> bool:
    """Evaluate one attribute operator with explicit ASCII case rules."""
    if condition.operator == "exists":
        return True
    insensitive = condition.flag == "i" or (
        condition.flag != "s" and html and ascii_lower(condition.name) in _INSENSITIVE
    )
    actual = ascii_lower(value) if insensitive else value
    expected = ascii_lower(condition.value) if insensitive else condition.value
    if condition.operator == "=":
        return actual == expected
    if condition.operator == "^=":
        return bool(expected) and actual.startswith(expected)
    if condition.operator == "$=":
        return bool(expected) and actual.endswith(expected)
    if condition.operator == "*=":
        return bool(expected) and expected in actual
    if condition.operator == "~=":
        return (
            bool(expected)
            and not re.search(r"[ \t\n\r\f]", expected)
            and expected in re.split(r"[ \t\n\r\f]+", actual)
        )
    return actual == expected or actual.startswith(expected + "-")


def _matches_compound(compound: Compound, element: HtmlElement) -> bool:
    """Match native HTML/foreign element names and attributes."""
    if not isinstance(element.tag, str):
        return False
    html = not element.tag.startswith("{") or element.tag.startswith(
        "{http://www.w3.org/1999/xhtml}"
    )
    tag = element.tag.rsplit("}", 1)[-1]
    if compound.tag is not None and (ascii_lower(tag) if html else tag) != (
        ascii_lower(compound.tag) if html else compound.tag
    ):
        return False
    if any(element.get("id") != identifier for identifier in compound.ids):
        return False
    for condition in compound.attributes:
        value = element.get(ascii_lower(condition.name) if html else condition.name)
        if value is None or not _matches_value(condition, value, html):
            return False
    return True


def _matches_complex(selector: tuple[Compound, ...], element: HtmlElement) -> bool:
    """Walk ancestors for each preceding descendant component."""
    if not selector or not _matches_compound(selector[-1], element):
        return False
    index = len(selector) - 2
    ancestor = element.getparent()
    while index >= 0 and ancestor is not None:
        if _matches_compound(selector[index], ancestor):
            index -= 1
        ancestor = ancestor.getparent()
    return index < 0


def query_all(root: HtmlElement | None, selector: str) -> list[HtmlElement]:
    """Return matching descendants in document order with no duplicate results."""
    if root is None:
        return []
    selectors = compile_selector_list(selector)
    return [
        node
        for node in root.iterdescendants()
        if isinstance(node.tag, str) and any(_matches_complex(part, node) for part in selectors)
    ]


def query(root: HtmlElement | None, selector: str) -> HtmlElement | None:
    """Return the first matching descendant."""
    return next(iter(query_all(root, selector)), None)


def content_root(document: HtmlElement) -> HtmlElement:
    """Prefer the body while retaining fragment support."""
    body = query(document, "body")
    return document if body is None else body


def text_content(element: HtmlElement | None) -> str:
    """Concatenate descendant text without adding whitespace."""
    return "" if element is None else "".join(element.itertext())


def iter_text(element: HtmlElement) -> str:
    """Join separate lxml text segments with metadata's space separator."""
    return " ".join(element.itertext())
