# SPDX-License-Identifier: Apache-2.0
# HTML output conversion derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/htmlprocessing.py::HTML_CONVERSIONS/convert_to_html
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/htmlprocessing.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: added an iterative Python fragment writer with a cumulative output limit.
"""Internal-tag conversion and bounded unsanitized HTML fragment output."""

from __future__ import annotations

import re
from dataclasses import dataclass
from html import escape

from ._errors import ResourceLimitError
from ._htmlprocessing import REND_TAG_MAPPING
from ._limits import MAX_OUTPUT_BYTES
from ._tree import Tree, byte_length
from ._utils import strip_space

CONVERSIONS = {
    "list": "ul",
    "item": "li",
    "code": "pre",
    "quote": "blockquote",
    "lb": "br",
    "graphic": "img",
    "ref": "a",
    "row": "tr",
}
VOID = frozenset(
    (
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "source",
        "track",
        "wbr",
    )
)


def convert_to_html(tree: Tree, body: int) -> None:
    """Convert the selected internal tree and restrict its carried attributes."""
    rendition = {value: tag for tag, value in REND_TAG_MAPPING}
    for node in tree.collect_tree(body):
        original = tree.tag(node)
        tag = CONVERSIONS.get(original)
        if original == "head":
            level = tree.get(node, "rend")
            if level is None:
                level = "h3"
            tag = level if re.fullmatch(r"h[1-6]", level) else "h3"
        elif original == "hi":
            tag = rendition.get(tree.get(node, "rend") or "#i", "i")
        elif original == "cell":
            tag = "th" if tree.get(node, "role") == "head" else "td"
        if tag is None:
            continue
        tree.set_tag(node, tag)
        if tag == "a":
            href = tree.get(node, "target") or ""
            tree.clear_attrs(node)
            tree.set(node, "href", href)
        elif tag != "img":
            tree.clear_attrs(node)
    tree.set_tag(body, "body")


class OutputBudget:
    """One UTF-8 allowance shared by body and comment serialization."""

    def __init__(self, limit: int = MAX_OUTPUT_BYTES) -> None:
        """Bind the immutable output limit."""
        self.limit, self.emitted = limit, 0

    def charge(self, value: str) -> None:
        """Reject before appending bytes over the limit."""
        total = self.emitted + byte_length(value)
        if total > self.limit:
            raise ResourceLimitError("output exceeds the UTF-8 byte limit")
        self.emitted = total


@dataclass
class _Frame:
    """A serializer stack frame holding only its live child cursor."""

    node: int
    entered: bool = False
    child: int = 0


def _escaped(value: str, attribute: bool = False) -> str:
    """Match the source escaping without unnecessarily escaping apostrophes."""
    escaped = escape(value, quote=False)
    return escaped.replace('"', "&quot;") if attribute else escaped


def serialize_fragment(tree: Tree, body: int, budget: OutputBudget) -> str:
    """Write inner HTML iteratively, including text carried by converted void tags."""
    output: list[str] = []

    def emit(value: str) -> None:
        """Charge each fragment before retaining it."""
        budget.charge(value)
        output.append(value)

    stack = [_Frame(body)]
    while stack:
        frame = stack[-1]
        root = len(stack) == 1
        tag = tree.tag(frame.node)
        if not frame.entered:
            frame.entered = True
            if not root:
                emit("<")
                emit(tag)
                for name, value in tree.node(frame.node).attrs.items():
                    emit(" ")
                    emit(name)
                    emit('="')
                    emit(_escaped(value, True))
                    emit('"')
                emit(" />" if tag in VOID else ">")
            text = tree.text(frame.node)
            if text is not None:
                emit(_escaped(text))
        children = tree.children(frame.node)
        if frame.child < len(children):
            child = children[frame.child]
            frame.child += 1
            stack.append(_Frame(child))
            continue
        if not root:
            if tag not in VOID:
                emit("</")
                emit(tag)
                emit(">")
            tail = tree.tail(frame.node)
            if tail is not None:
                emit(_escaped(tail))
        stack.pop()
    return "".join(output)


def result_text(tree: Tree, body: int) -> str:
    """Read the source's extraction-text representation."""
    return strip_space(" ".join(tree.itertext_parts(body)))
