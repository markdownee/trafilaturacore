# SPDX-License-Identifier: Apache-2.0 AND BSD-3-Clause
# Element deletion derived in part from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/xml.py::delete_element, including inherited lxml.html ancestry
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/xml.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Inherited lxml.html attribution:
#   https://github.com/lxml/lxml/blob/master/src/lxml/html/__init__.py
# lxml.html Copyright (c) 2004 Ian Bicking (BSD-3-Clause; engine notices).
# Modified: added a Python tree arena with dictionary-backed nodes and resource errors.
"""Bounded stable-identifier tree translated from the primary TypeScript engine."""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field

from ._errors import ResourceLimitError
from ._settings import (
    MAX_ARENA_NODES,
    MAX_ARENA_STRING_BYTES,
    MAX_STRIP_VISITS,
    TABLE_CELL_BUDGET,
)


def byte_length(value: str) -> int:
    """Count UTF-8 bytes with JavaScript-compatible lone-surrogate replacement."""
    return len(value.encode("utf-8", errors="surrogatepass"))


@dataclass
class TreeNode:
    """An element owns text and children; its following text belongs to tail."""

    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    text: str | None = None
    tail: str | None = None
    children: list[int] = field(default_factory=list)
    parent: int | None = None


class Tree:
    """Stable node storage with cumulative allocation and transformation budgets."""

    def __init__(
        self,
        arena_node_limit: int = MAX_ARENA_NODES,
        table_cell_limit: int = TABLE_CELL_BUDGET,
        arena_string_limit: int = MAX_ARENA_STRING_BYTES,
        strip_visit_limit: int = MAX_STRIP_VISITS,
    ) -> None:
        """Create one arena shared by source nodes and all extraction copies."""
        self.storage: list[TreeNode] = []
        self.positions: dict[int, int] = {}
        self.limits = {
            "arena-nodes": arena_node_limit,
            "arena-string-bytes": arena_string_limit,
            "table-cells": table_cell_limit,
            "strip-visits": strip_visit_limit,
        }
        self.used = dict.fromkeys(self.limits, 0)

    def consume(self, resource: str, amount: int) -> None:
        """Reject before a cumulative budget would be exceeded."""
        observed = self.used[resource] + amount
        if observed > self.limits[resource]:
            raise ResourceLimitError(f"{resource} limit exceeded")
        self.used[resource] = observed

    def charge_table_cell(self) -> bool:
        """Charge one materialized table cell."""
        self.consume("table-cells", 1)
        return True

    def node(self, identifier: int) -> TreeNode:
        """Return an existing stable node."""
        return self.storage[identifier]

    def create(self, tag: str) -> int:
        """Allocate a detached element."""
        self.consume("arena-nodes", 1)
        self.consume("arena-string-bytes", byte_length(tag))
        identifier = len(self.storage)
        self.storage.append(TreeNode(tag))
        return identifier

    def create_sub(self, parent: int, tag: str) -> int:
        """Allocate and append a child."""
        child = self.create(tag)
        self.append(parent, child)
        return child

    def tag(self, identifier: int) -> str:
        """Read the tag."""
        return self.node(identifier).tag

    def set_tag(self, identifier: int, tag: str) -> None:
        """Replace a tag and charge its new bytes."""
        self.consume("arena-string-bytes", byte_length(tag))
        self.node(identifier).tag = tag

    def mark_done(self, identifier: int) -> None:
        """Mark a node consumed by extraction."""
        self.set_tag(identifier, "done")

    def is_done(self, identifier: int) -> bool:
        """Test the extraction marker."""
        return self.tag(identifier) == "done"

    def get(self, identifier: int, name: str) -> str | None:
        """Read an optional attribute."""
        return self.node(identifier).attrs.get(name)

    def get_or_empty(self, identifier: int, name: str) -> str:
        """Read an attribute using the XPath empty-string default."""
        return self.get(identifier, name) or ""

    def set(self, identifier: int, name: str, value: str) -> None:
        """Set an attribute while retaining source order."""
        attributes = self.node(identifier).attrs
        self.consume(
            "arena-string-bytes",
            byte_length(value) + (0 if name in attributes else byte_length(name)),
        )
        attributes[name] = value

    def pop_attr(self, identifier: int, name: str) -> str | None:
        """Remove and return an attribute."""
        return self.node(identifier).attrs.pop(name, None)

    def clear_attrs(self, identifier: int) -> None:
        """Remove all attributes."""
        self.node(identifier).attrs.clear()

    def has_attrs(self, identifier: int) -> bool:
        """Test whether an element has attributes."""
        return bool(self.node(identifier).attrs)

    def text(self, identifier: int) -> str | None:
        """Read leading element text."""
        return self.node(identifier).text

    def tail(self, identifier: int) -> str | None:
        """Read text following an element."""
        return self.node(identifier).tail

    def _assign(self, identifier: int, slot: str, value: str | None) -> None:
        """Charge and assign a text slot."""
        if value is not None:
            self.consume("arena-string-bytes", byte_length(value))
        setattr(self.node(identifier), slot, value)

    def set_text(self, identifier: int, value: str | None) -> None:
        """Replace leading text."""
        self._assign(identifier, "text", value)

    def set_tail(self, identifier: int, value: str | None) -> None:
        """Replace following text."""
        self._assign(identifier, "tail", value)

    def _concatenate(self, identifier: int, slot: str, value: str) -> None:
        """Append to a slot, charging only appended bytes."""
        self.consume("arena-string-bytes", byte_length(value))
        node = self.node(identifier)
        setattr(node, slot, (getattr(node, slot) or "") + value)

    def append_text(self, identifier: int, value: str) -> None:
        """Append leading text."""
        self._concatenate(identifier, "text", value)

    def append_tail(self, identifier: int, value: str) -> None:
        """Append following text."""
        self._concatenate(identifier, "tail", value)

    def children(self, identifier: int) -> list[int]:
        """Read live direct children."""
        return self.node(identifier).children

    def child_count(self, identifier: int) -> int:
        """Count direct children."""
        return len(self.children(identifier))

    def parent(self, identifier: int) -> int | None:
        """Read the optional parent."""
        return self.node(identifier).parent

    def index_in_parent(self, identifier: int) -> int | None:
        """Find a sibling using the validated local traversal cursor."""
        parent = self.parent(identifier)
        if parent is None:
            return None
        children = self.children(parent)
        cursor = self.positions.get(parent, 0)
        for index in (cursor, cursor + 1, cursor - 1):
            if 0 <= index < len(children) and children[index] == identifier:
                self.positions[parent] = index
                return index
        try:
            index = children.index(identifier)
        except ValueError:
            return None
        self.positions[parent] = index
        return index

    def previous(self, identifier: int) -> int | None:
        """Find the preceding sibling."""
        index, parent = self.index_in_parent(identifier), self.parent(identifier)
        return (
            self.children(parent)[index - 1]
            if parent is not None and index is not None and index > 0
            else None
        )

    def next_sibling(self, identifier: int) -> int | None:
        """Find the following sibling."""
        index, parent = self.index_in_parent(identifier), self.parent(identifier)
        if parent is None or index is None or index + 1 >= self.child_count(parent):
            return None
        return self.children(parent)[index + 1]

    def detach(self, identifier: int) -> None:
        """Remove a node without deleting its stable record or tail."""
        parent = self.parent(identifier)
        if parent is None:
            return
        index = self.index_in_parent(identifier)
        if index is not None:
            del self.children(parent)[index]
        self.node(identifier).parent = None
        self.positions[parent] = index or 0

    def append(self, parent: int, child: int) -> None:
        """Move a node to the end of a parent's children."""
        if parent == child:
            return
        self.detach(child)
        self.children(parent).append(child)
        self.node(child).parent = parent

    def insert(self, parent: int, index: int, child: int) -> None:
        """Move a node to a specified child position."""
        if parent == child:
            return
        self.detach(child)
        self.children(parent).insert(min(index, self.child_count(parent)), child)
        self.node(child).parent = parent
        self.positions.pop(parent, None)

    def extend(self, parent: int, nodes: Sequence[int]) -> None:
        """Append the supplied children in order."""
        for child in nodes:
            self.append(parent, child)

    def delete_element(self, identifier: int, keep_tail: bool) -> None:
        """Translate the source helper's lxml-derived tail-preserving removal."""
        parent = self.parent(identifier)
        if parent is None:
            return
        tail = self.tail(identifier)
        if keep_tail and tail:
            previous = self.previous(identifier)
            if previous is None:
                self.append_text(parent, tail)
            else:
                self.append_tail(previous, tail)
        self.detach(identifier)

    def _transfer(self, parent: int, previous: int | None, value: str) -> None:
        """Move a string directly; charge only when merging allocated buffers."""
        if not value:
            return
        destination = self.node(parent if previous is None else previous)
        slot = "text" if previous is None else "tail"
        current = getattr(destination, slot)
        if current is not None:
            self.consume("arena-string-bytes", byte_length(value))
        setattr(destination, slot, value if current is None else current + value)

    def delete_elements_batch(self, nodes: Sequence[int], keep_tail: bool) -> None:
        """Compact each affected parent once, retaining adjacent tail order."""
        removed = set(nodes)
        parents = dict.fromkeys(self.parent(node) for node in nodes)
        for parent in parents:
            if parent is None:
                continue
            kept: list[int] = []
            for child in self.children(parent):
                if child not in removed:
                    kept.append(child)
                    continue
                if keep_tail:
                    self._transfer(parent, kept[-1] if kept else None, self.tail(child) or "")
                self.node(child).parent = None
            self.node(parent).children = kept
            self.positions.pop(parent, None)

    def move_groups_after(self, groups: Sequence[tuple[int, list[int]]]) -> None:
        """Move child groups after anchors with one compaction per parent."""
        moves: dict[int, list[int]] = {}
        parents: dict[int, None] = {}
        detached: list[int] = []
        for anchor, nodes in groups:
            parent = self.parent(anchor)
            if parent is None:
                continue
            parents[parent] = None
            moves.setdefault(anchor, []).extend(nodes)
            detached.extend(nodes)
        self.delete_elements_batch(detached, False)
        for parent in parents:
            rebuilt: list[int] = []
            for child in self.children(parent):
                rebuilt.append(child)
                for moved in moves.pop(child, []):
                    rebuilt.append(moved)
                    self.node(moved).parent = parent
            self.node(parent).children = rebuilt
            self.positions.pop(parent, None)

    def _successor(self, identifier: int, root: int) -> int | None:
        """Walk live links to the following preorder node."""
        children = self.children(identifier)
        if children:
            return children[0]
        cursor: int | None = identifier
        while cursor is not None and cursor != root:
            following = self.next_sibling(cursor)
            if following is not None:
                return following
            cursor = self.parent(cursor)
        return None

    def _matching(self, start: int | None, root: int, tags: Sequence[str]) -> int | None:
        """Find the next live preorder tag match."""
        while start is not None:
            if not tags or self.tag(start) in tags:
                return start
            start = self._successor(start, root)
        return None

    def lxml_first_tree_match(self, root: int, tags: Sequence[str]) -> int | None:
        """Match the root or a descendant."""
        return self._matching(root, root, tags)

    def lxml_first_descendant_match(self, root: int, tags: Sequence[str]) -> int | None:
        """Match a descendant excluding the root."""
        children = self.children(root)
        return self._matching(children[0] if children else None, root, tags)

    def lxml_next_match(self, current: int, root: int, tags: Sequence[str]) -> int | None:
        """Find the next match using current live links."""
        return self._matching(self._successor(current, root), root, tags)

    def iter_tree(self, root: int) -> Iterator[int]:
        """Yield preorder with a prefetched successor, matching the source iterator."""
        cursor: int | None = root
        while cursor is not None:
            current = cursor
            cursor = self._successor(current, root)
            yield current

    def iter_descendants(self, root: int) -> Iterator[int]:
        """Yield descendants without the root."""
        children = self.children(root)
        cursor = children[0] if children else None
        while cursor is not None:
            current = cursor
            cursor = self._successor(current, root)
            yield current

    def collect_tree(self, root: int) -> list[int]:
        """Snapshot preorder nodes."""
        return list(self.iter_tree(root))

    def collect_descendants(self, root: int) -> list[int]:
        """Snapshot descendant nodes."""
        return list(self.iter_descendants(root))

    def collect_tree_where(self, root: int, predicate: Callable[[int], bool]) -> list[int]:
        """Snapshot matching nodes including the root."""
        return [node for node in self.iter_tree(root) if predicate(node)]

    def collect_descendants_where(self, root: int, predicate: Callable[[int], bool]) -> list[int]:
        """Snapshot matching descendants."""
        return [node for node in self.iter_descendants(root) if predicate(node)]

    def collect_descendants_by_tag(self, root: int, tags: Sequence[str]) -> list[int]:
        """Snapshot descendants belonging to a tag family."""
        return self.collect_descendants_where(root, lambda node: self.tag(node) in tags)

    def find_descendant_where(self, root: int, predicate: Callable[[int], bool]) -> int | None:
        """Find the first matching descendant."""
        return next((node for node in self.iter_descendants(root) if predicate(node)), None)

    def any_descendant(self, root: int, predicate: Callable[[int], bool]) -> bool:
        """Test for a matching descendant."""
        return self.find_descendant_where(root, predicate) is not None

    def find_all_children(self, root: int, tag: str) -> list[int]:
        """Find matching direct children."""
        return [child for child in self.children(root) if self.tag(child) == tag]

    def find_child(self, root: int, tag: str) -> int | None:
        """Find the first matching direct child."""
        return next(iter(self.find_all_children(root, tag)), None)

    def find_descendant(self, root: int, tag: str) -> int | None:
        """Find the first descendant with the given tag."""
        return self.find_descendant_where(root, lambda node: self.tag(node) == tag)

    def has_ancestor(self, node: int, tag: str) -> bool:
        """Test ancestor tags without including the node."""
        parent = self.parent(node)
        while parent is not None:
            if self.tag(parent) == tag:
                return True
            parent = self.parent(parent)
        return False

    def _inside(self, node: int, ancestor: int) -> bool:
        """Test stable ancestor identity."""
        parent = self.parent(node)
        while parent is not None:
            if parent == ancestor:
                return True
            parent = self.parent(parent)
        return False

    def delete_all_with_tag_lxml(self, root: int, tag: str) -> None:
        """Retain the source's prefetched-match and detached-subtree stop semantics."""
        matches = self.collect_tree_where(root, lambda node: self.tag(node) == tag)
        boundary: int | None = None
        removed = []
        for index, node in enumerate(matches):
            if boundary is not None and not self._inside(node, boundary):
                break
            removed.append(node)
            if (
                boundary is None
                and index + 1 < len(matches)
                and self._inside(matches[index + 1], node)
            ):
                boundary = node
        self.delete_elements_batch(removed, True)

    def itertext_parts(self, root: int) -> list[str]:
        """Collect text and descendant tails, excluding the root tail."""
        result: list[str] = []
        stack: list[tuple[int, bool]] = [(root, False)]
        while stack:
            node, tail = stack.pop()
            value = self.tail(node) if tail else self.text(node)
            if value is not None:
                result.append(value)
            if tail:
                continue
            for child in reversed(self.children(node)):
                stack.append((child, True))
                stack.append((child, False))
        return result

    def itertext(self, root: int) -> str:
        """Join the source text traversal."""
        return "".join(self.itertext_parts(root))

    def strip_tags(self, root: int, tags: Sequence[str]) -> None:
        """Unwrap selected descendant tags in a bounded bottom-up pass."""
        if not tags:
            return
        selected = set(tags)
        for parent in reversed(self.collect_tree(root)):
            children = self.children(parent)
            self.consume("strip-visits", len(children))
            if not any(self.tag(child) in selected for child in children):
                continue
            rebuilt: list[int] = []
            for child in children:
                node = self.node(child)
                if node.tag not in selected:
                    rebuilt.append(child)
                    continue
                self._transfer(parent, rebuilt[-1] if rebuilt else None, node.text or "")
                node.text = None
                for grandchild in node.children:
                    self.node(grandchild).parent = parent
                    rebuilt.append(grandchild)
                node.children = []
                self.positions.pop(child, None)
                self._transfer(parent, rebuilt[-1] if rebuilt else None, node.tail or "")
                node.tail = None
                node.parent = None
            self.node(parent).children = rebuilt
            self.positions.pop(parent, None)

    def strip_elements(self, root: int, tags: Sequence[str]) -> None:
        """Discard matching descendant subtrees, including their tails."""
        selected = set(tags)
        pending = [root]
        while pending:
            parent = pending.pop()
            kept = []
            for child in self.children(parent):
                if self.tag(child) in selected:
                    self.node(child).parent = None
                else:
                    kept.append(child)
                    pending.append(child)
            self.node(parent).children = kept
            self.positions.pop(parent, None)

    def unwrap_element(self, identifier: int) -> None:
        """Replace one wrapper with its text, children and tail."""
        parent, index = self.parent(identifier), self.index_in_parent(identifier)
        if parent is None or index is None:
            return
        children = self.children(parent)
        node = self.node(identifier)
        previous = children[index - 1] if index else None
        if node.text:
            if previous is None:
                self.append_text(parent, node.text)
            else:
                self.append_tail(previous, node.text)
        rebuilt = children[:index]
        for child in node.children:
            self.node(child).parent = parent
            rebuilt.append(child)
        if node.tail:
            if rebuilt:
                self.append_tail(rebuilt[-1], node.tail)
            else:
                self.append_text(parent, node.tail)
        rebuilt.extend(children[index + 1 :])
        node.text = node.tail = None
        node.children = []
        node.parent = None
        self.node(parent).children = rebuilt
        self.positions.pop(parent, None)
        self.positions.pop(identifier, None)

    def deep_copy(self, identifier: int) -> int:
        """Clone a subtree and charge each complete payload once."""
        source = self.node(identifier)
        cost = (
            byte_length(source.tag)
            + byte_length(source.text or "")
            + byte_length(source.tail or "")
        )
        cost += sum(byte_length(key) + byte_length(value) for key, value in source.attrs.items())
        self.consume("arena-nodes", 1)
        self.consume("arena-string-bytes", cost)
        destination = len(self.storage)
        copied = TreeNode(source.tag, dict(source.attrs), source.text, source.tail)
        self.storage.append(copied)
        for child in source.children:
            clone = self.deep_copy(child)
            copied.children.append(clone)
            self.node(clone).parent = destination
        return destination
