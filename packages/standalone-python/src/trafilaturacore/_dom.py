# SPDX-License-Identifier: Apache-2.0
# Parser policy inherited from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/utils.py::HTML_PARSER
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/utils.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: lxml recovery and bounded parsing feed a Python tree arena.
"""Offline lxml parsing and conversion into the primary engine's tree model."""

from __future__ import annotations

from lxml.html import HtmlElement, HTMLParser, document_fromstring

from ._errors import ResourceLimitError
from ._limits import MAX_DEPTH, MAX_INPUT_BYTES, MAX_NODES, preflight
from ._tree import Tree


def parse_html(source: str) -> HtmlElement:
    """Parse preflighted supplied HTML without network or external entity loading."""
    parser = HTMLParser(
        encoding="utf-8",
        no_network=True,
        recover=True,
        remove_comments=True,
        remove_pis=True,
        huge_tree=False,
    )
    tree = document_fromstring(
        (source or "<html><body></body></html>").encode("utf-8"), parser=parser
    )
    pending = [(tree, 0)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if count > MAX_NODES or depth > MAX_DEPTH:
            raise ResourceLimitError("parsed tree exceeds the node or depth limit")
        pending.extend((child, depth + 1) for child in node)
    return tree


def arena_from_document(document: HtmlElement) -> tuple[Tree, int]:
    """Copy a bounded lxml document into stable-id text/tail records."""
    arena = Tree()
    root = arena.create(document.tag)
    pending = [(document, root)]
    while pending:
        source, target = pending.pop()
        for name, value in source.attrib.items():
            arena.set(target, name, value)
        arena.set_text(target, source.text)
        arena.set_tail(target, source.tail)
        children = []
        for child in source:
            if not isinstance(child.tag, str):
                continue
            copied = arena.create_sub(target, child.tag)
            children.append((child, copied))
        pending.extend(reversed(children))
    return arena, root


def parse_document(source: str) -> tuple[Tree, int]:
    """Validate internal fragments before any recovery parse and arena conversion."""
    preflight(source, MAX_INPUT_BYTES)
    return arena_from_document(parse_html(source))
