# SPDX-License-Identifier: Apache-2.0
# Main extraction derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/main_extractor.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/main_extractor.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted traversal and handlers with table budgets and bounded duplicate scans.
"""Main-body, comments, table and inline extraction from the bounded arena."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass

from ._extract_options import Options
from ._htmlprocessing import (
    delete_by_link_density,
    handle_textnode,
    join_url_compat,
    link_density_test_tables,
    process_node,
    prune_unwanted_nodes,
)
from ._selectors import (
    BODY_RULES,
    COMMENTS_DISCARD_RULES,
    COMMENTS_RULES,
    DISCARD_IMAGE_RULES,
    OVERALL_DISCARD_RULES,
    PRECISION_DISCARD_RULES,
    TEASER_DISCARD_RULES,
    select_first,
)
from ._settings import (
    DEDUPE_SCAN_CAP,
    INLINE_CARRIED,
    MAX_SPAN,
    MIN_DUPLICATE_LENGTH,
    MIN_EXTRACTED_SIZE,
    TAG_CATALOG,
)
from ._tree import Tree
from ._unicode import DECIMAL_RANGES
from ._utils import FORMATTING_PROTECTED, is_image_file, strip_space, text_chars_test, trim

KEPT_ATTRIBUTES = frozenset(("rend", "role", "target", "src", "alt", "title"))
INLINE_WRAPPERS = frozenset(("hi", "ref", "del"))
FORMATTING = frozenset(("hi", "ref", "del", "span"))
CELLS = frozenset(("td", "th"))
QUOTE_TAGS = frozenset((*TAG_CATALOG, "ref", "graphic"))


@dataclass
class SelectedText:
    """An internal body node and its extraction-time text measurement."""

    body: int
    text: str
    length: int


def elem_text(tree: Tree, node: int) -> str:
    """Concatenate inline text before normalization."""
    return trim(tree.itertext(node))


def document_root(tree: Tree, node: int) -> int:
    """Walk to the current root, including detached subtrees."""
    while (parent := tree.parent(node)) is not None:
        node = parent
    return node


def span(tree: Tree, cell: int, attribute: str) -> int:
    """Read a capped nonnegative decimal span using the pinned Unicode table."""
    text = tree.get(cell, attribute)
    if text is None:
        text = "1"
    if not text:
        return 1
    value = 0
    for char in text:
        point = ord(char)
        interval = next((entry for entry in DECIMAL_RANGES if entry[0] <= point <= entry[1]), None)
        if interval is None:
            return 1
        value = min(MAX_SPAN, value * 10 + (point - interval[0]) % 10)
    return value


def is_code_block_element(tree: Tree, node: int) -> bool:
    """Recognize explicit code and the primary single-code-child pattern."""
    if tree.get(node, "lang") or tree.tag(node) == "code":
        return True
    parent = tree.parent(node)
    if parent is not None and "highlight" in tree.get_or_empty(parent, "class"):
        return True
    code = tree.find_child(node, "code")
    return (
        code is not None
        and tree.child_count(node) == 1
        and not strip_space(tree.text(node) or "")
        and not strip_space(tree.tail(code) or "")
    )


class MainExtractor:
    """One invocation's handlers, sharing options and cumulative arena limits."""

    def __init__(self, tree: Tree, options: Options) -> None:
        """Bind the primary algorithm context."""
        self.tree, self.options = tree, options

    def _live(
        self, root: int, tags: Sequence[str] = (), include_root: bool = False
    ) -> Iterator[int]:
        """Prefetch each match before caller mutations, as the source iterator does."""
        tree = self.tree
        cursor = (
            tree.lxml_first_tree_match(root, tags)
            if include_root
            else tree.lxml_first_descendant_match(root, tags)
        )
        while cursor is not None:
            current = cursor
            cursor = tree.lxml_next_match(current, root, tags)
            yield current

    def _rendition(self, source: int, target: int) -> None:
        """Carry a nonempty rendition attribute."""
        value = self.tree.get(source, "rend")
        if value:
            self.tree.set(target, "rend", value)

    def _define(self, source: int | None, target: int, carry: bool = False) -> None:
        """Copy text and allowed attributes, optionally consuming carried inline children."""
        if source is None:
            return
        tree = self.tree
        clone = tree.create_sub(target, tree.tag(source))
        tree.set_text(clone, tree.text(source))
        tree.set_tail(clone, tree.tail(source))
        for name, value in tree.node(source).attrs.items():
            if name in KEPT_ATTRIBUTES:
                tree.set(clone, name, value)
        if not carry:
            return
        for child in list(tree.children(source)):
            if tree.tag(child) not in INLINE_CARRIED and tree.tag(child) != "lb":
                continue
            self._define(child, clone, True)
            for node in tree.collect_tree(child):
                tree.mark_done(node)

    def _title(self, element: int) -> int | None:
        """Process a heading and its live child content."""
        tree = self.tree
        if tree.child_count(element) == 0:
            title = process_node(tree, element)
        else:
            title = tree.deep_copy(element)
            for child in list(tree.children(element)):
                processed = handle_textnode(tree, child, False, False)
                if processed is not None:
                    tree.append(title, processed)
                tree.mark_done(child)
        return title if title is not None and text_chars_test(tree.itertext(title)) else None

    def _formatting(self, element: int) -> int | None:
        """Retain formatting in protected parents or wrap it as a paragraph."""
        tree = self.tree
        formatted = process_node(tree, element)
        if formatted is None:
            return None
        parent = tree.parent(element)
        if parent is None:
            parent = tree.previous(element)
        if parent is not None and tree.tag(parent) in FORMATTING_PROTECTED:
            return formatted
        paragraph = tree.create("p")
        tree.insert(paragraph, 0, formatted)
        return paragraph

    def _nested(self, source: int, target: int) -> None:
        """Collect nested item content with carried inline structures."""
        tree = self.tree
        tree.set_text(target, tree.text(source))
        for child in self._live(source):
            if tree.tag(child) == "list":
                result = self._list(child)
                if result is not None:
                    tree.append(target, result)
            elif tree.tag(child) in INLINE_CARRIED:
                self._define(child, target, True)
            else:
                self._define(handle_textnode(tree, child, False, False), target)
            tree.mark_done(child)

    def _list(self, element: int) -> int | None:
        """Rebuild lists, preserving nested item text and rendition."""
        tree = self.tree
        result = tree.create(tree.tag(element))
        leading = tree.text(element)
        if leading is not None and strip_space(leading):
            tree.set_text(tree.create_sub(result, "item"), leading)
        for child in self._live(element, ("item",)):
            item = tree.create("item")
            if tree.child_count(child) == 0:
                processed = process_node(tree, child)
                if processed is not None:
                    tail = tree.tail(processed)
                    tree.set_text(
                        item,
                        (tree.text(processed) or "")
                        + (" " + tail if tail and strip_space(tail) else ""),
                    )
                    tree.append(result, item)
            else:
                self._nested(child, item)
                tail = tree.tail(child)
                if tail and strip_space(tail):
                    retained = [node for node in tree.children(item) if not tree.is_done(node)]
                    if retained:
                        last = retained[-1]
                        old = tree.tail(last)
                        tree.set_tail(last, old + " " + tail if old and strip_space(old) else tail)
            if tree.text(item) or tree.child_count(item):
                self._rendition(child, item)
                tree.append(result, item)
            tree.mark_done(child)
        tree.mark_done(element)
        if not text_chars_test(tree.itertext(result)):
            return None
        self._rendition(element, result)
        return result

    def _code(self, element: int) -> int:
        """Copy code without flattening whitespace and mark the original consumed."""
        tree = self.tree
        copied = tree.deep_copy(element)
        for node in tree.collect_tree(element):
            tree.mark_done(node)
        tree.set_tag(copied, "code")
        return copied

    def _quote(self, element: int) -> int | None:
        """Process quoted blocks and preserved code."""
        tree = self.tree
        if is_code_block_element(tree, element):
            return self._code(element)
        result = tree.create(tree.tag(element))
        tree.set_text(result, tree.text(element))
        for child in self._live(element):
            if tree.tag(child) == "graphic":
                self._define(self.image(child), result)
            elif tree.tag(child) == "p" and tree.child_count(child) > 0:
                paragraph = self._paragraph(child, QUOTE_TAGS)
                if paragraph is not None:
                    tree.append(result, paragraph)
            elif tree.tag(child) in INLINE_CARRIED:
                self._define(child, result, True)
            else:
                self._define(process_node(tree, child), result)
            tree.mark_done(child)
        if not text_chars_test(tree.itertext(result)):
            return None
        tree.strip_tags(result, ("quote",))
        return result

    def _paragraph(self, element: int, allowed: frozenset[str] | set[str]) -> int | None:
        """Rebuild a paragraph while preserving inline order and whitespace."""
        tree = self.tree
        tree.clear_attrs(element)
        if not tree.child_count(element):
            return process_node(tree, element)
        result = tree.create(tree.tag(element))
        for child in self._live(element, include_root=True):
            if tree.tag(child) not in allowed and not tree.is_done(child):
                continue
            processed = handle_textnode(tree, child, False, True)
            if processed is not None:
                if tree.tag(processed) == "p":
                    current = tree.text(result)
                    value = tree.text(processed) or ""
                    tree.set_text(result, current + " " + value if current else value)
                    tree.mark_done(child)
                    continue
                tag = tree.tag(child)
                created = tree.create(tag)
                if tree.tag(processed) in {"hi", "ref"}:
                    wraps = tree.child_count(processed) > 0 and (
                        tree.tag(processed) == "ref"
                        or any(
                            tree.tag(node) in INLINE_CARRIED for node in tree.children(processed)
                        )
                    )
                    if wraps:
                        self._define(processed, result, True)
                        tree.mark_done(child)
                        continue
                    children = tree.children(processed)
                    item = children[0] if children else None
                    while item is not None:
                        current = item
                        item = tree.next_sibling(current)
                        if tree.tag(current) == "lb" and tree.tail(current) is not None:
                            tree.set_tail(current, " " + (tree.tail(current) or "").lstrip())
                        elif text_chars_test(tree.text(current)):
                            tree.set_text(current, " " + (tree.text(current) or ""))
                        tree.strip_tags(processed, (tree.tag(current),))
                    if tag == "hi":
                        tree.set(created, "rend", tree.get_or_empty(child, "rend"))
                    elif tag == "ref":
                        target = tree.get(child, "target")
                        if target is not None:
                            tree.set(created, "target", target)
                tree.set_text(created, tree.text(processed))
                tree.set_tail(created, tree.tail(processed))
                if tree.tag(processed) == "graphic":
                    image = self.image(processed)
                    if image is not None:
                        created = image
                tree.append(result, created)
            tree.mark_done(child)
        children = tree.children(result)
        if children:
            last = children[-1]
            if tree.tag(last) == "lb" and tree.tail(last) is None:
                tree.delete_element(last, False)
            return result
        return result if tree.text(result) else None

    def _cell(self, header: bool) -> int:
        """Charge every rebuilt or padded table cell."""
        self.tree.charge_table_cell()
        cell = self.tree.create("cell")
        if header:
            self.tree.set(cell, "role", "head")
        return cell

    def _fill_cell(self, target: int, source: int, nested: set[int], allowed: set[str]) -> None:
        """Populate one cell while excluding nested table content."""
        tree = self.tree
        if not tree.child_count(source):
            processed = process_node(tree, source)
            if processed is not None:
                tree.set_text(target, tree.text(processed))
                tree.set_tail(target, tree.tail(processed))
            return
        tree.set_text(target, tree.text(source))
        tree.set_tail(target, tree.tail(source))
        tree.mark_done(source)
        for child in self._live(source):
            if tree.is_done(child):
                continue
            if child in nested:
                tail = tree.tail(child)
                if tree.tag(child) == "table" and tail:
                    if tree.children(target):
                        tree.append_tail(tree.children(target)[-1], tail)
                    else:
                        tree.append_text(target, tail)
                continue
            if tree.tag(child) in CELLS:
                tree.set_tag(child, "cell")
                processed = handle_textnode(tree, child, True, True)
            elif tree.tag(child) in INLINE_WRAPPERS:
                processed = handle_textnode(tree, child, True, True)
                if processed is None and tree.child_count(child) > 0:
                    self._define(child, target, True)
                    for node in tree.collect_tree(child):
                        tree.mark_done(node)
                    continue
            elif tree.tag(child) == "list" and self.options.focus == "recall":
                processed = self._list(child)
                if processed is not None:
                    tree.append(target, processed)
                tree.mark_done(child)
                continue
            else:
                processed = self._handle(child, allowed)
            self._define(processed, target, True)
            tree.mark_done(child)

    def _table(self, element: int, allowed: frozenset[str] | set[str]) -> int | None:
        """Rebuild row/column spans, captions and first-row headers within one budget."""
        tree = self.tree
        result = tree.create("table")
        cell_tags = set(allowed) | {"div"}
        tree.strip_tags(element, ("thead", "tbody", "tfoot"))
        nested = set()
        for table in tree.collect_descendants_by_tag(element, ("table",)):
            nested.update(tree.collect_tree(table))
        width = 0
        for row in tree.find_all_children(element, "tr"):
            columns = sum(
                span(tree, cell, "colspan")
                for cell in tree.children(row)
                if tree.tag(cell) in CELLS
            )
            width = max(width, min(columns, MAX_SPAN))

        def pad(row: int) -> None:
            """Pad a row to the measured width."""
            while tree.child_count(row) < width:
                tree.append(row, self._cell(False))

        for caption in tree.find_all_children(element, "caption"):
            text = strip_space(" ".join(tree.itertext_parts(caption)))
            if text:
                row = tree.create("row")
                cell = self._cell(True)
                tree.set_text(cell, text)
                tree.append(row, cell)
                pad(row)
                tree.append(result, row)
            tree.mark_done(caption)
        occupied: dict[int, int] = {}

        def flush(row: int) -> None:
            """Account for columns occupied by preceding rowspans."""
            while (column := tree.child_count(row)) in occupied:
                remaining = occupied[column]
                tree.append(row, self._cell(False))
                if remaining <= 1:
                    del occupied[column]
                else:
                    occupied[column] = remaining - 1

        def finish(row: int) -> None:
            """Complete padding and retain rows with actual content."""
            flush(row)
            pad(row)
            if any(tree.text(cell) or tree.child_count(cell) > 0 for cell in tree.children(row)):
                tree.append(result, row)

        row = tree.create("row")
        header_emitted = has_header = False
        for element_child in list(tree.children(element)):
            if tree.tag(element_child) == "tr":
                if tree.child_count(row):
                    finish(row)
                    header_emitted |= has_header
                row = tree.create("row")
                has_header = False
                flush(row)
                cells = list(tree.children(element_child))
            elif tree.tag(element_child) in CELLS:
                cells = [element_child]
            else:
                if tree.tag(element_child) != "table":
                    tree.mark_done(element_child)
                continue
            for original in cells:
                if tree.tag(original) not in CELLS:
                    continue
                header = tree.tag(original) == "th" and not header_emitted
                has_header |= header
                flush(row)
                cell = self._cell(header)
                columns, rows = span(tree, original, "colspan"), span(tree, original, "rowspan")
                if rows > 1:
                    start = tree.child_count(row)
                    for column in range(start, start + columns):
                        occupied[column] = rows - 1
                self._fill_cell(cell, original, nested, cell_tags)
                tree.append(row, cell)
                for _column in range(1, columns):
                    tree.append(row, self._cell(header))
                tree.mark_done(original)
            tree.mark_done(element_child)
        finish(row)
        return result if tree.child_count(result) else None

    def image(self, element: int | None) -> int | None:
        """Select a supported source and retain the extraction image attributes."""
        if element is None:
            return None
        tree = self.tree
        result = tree.create(tree.tag(element))
        source = next(
            (
                tree.get_or_empty(element, name)
                for name in ("data-src", "src")
                if is_image_file(tree.get_or_empty(element, name))
            ),
            None,
        )
        if source is None:
            source = next(
                (
                    value
                    for name, value in tree.node(element).attrs.items()
                    if name.startswith("data-src") and is_image_file(value)
                ),
                None,
            )
        if source is not None:
            tree.set(result, "src", source)
        for name in ("alt", "title"):
            value = tree.get(element, name)
            if value:
                tree.set(result, name, value)
        url = tree.get_or_empty(result, "src")
        if not url:
            return None
        if not url.startswith("http"):
            resolved = (
                ("http:" + url if url.startswith("//") else url)
                if self.options.url is None
                else join_url_compat(self.options.url, url)
            )
            tree.set(result, "src", resolved)
        tree.set_tail(result, tree.tail(element))
        return result

    def _handle(self, element: int, allowed: frozenset[str] | set[str]) -> int | None:
        """Dispatch one internal element to its source-equivalent handler."""
        tree = self.tree
        tag = tree.tag(element)
        if tag == "list":
            return self._list(element)
        if tag in {"code", "quote"}:
            return self._quote(element)
        if tag == "head":
            return self._title(element)
        if tag == "p":
            return self._paragraph(element, allowed)
        if tag == "lb":
            if not text_chars_test(tree.tail(element)):
                return None
            processed = process_node(tree, element)
            if processed is None:
                return None
            paragraph = tree.create("p")
            tree.set_text(paragraph, tree.tail(processed))
            return paragraph
        if tag in FORMATTING:
            return self._formatting(element)
        if tag == "table" and tag in allowed:
            return self._table(element, allowed)
        if tag == "graphic" and tag in allowed:
            return self.image(element)
        if tag == "div" and "w3-code" in tree.get_or_empty(element, "class"):
            return self._code(element)
        if tag == "div" and tag in allowed:
            processed = handle_textnode(tree, element, False, True)
            if processed is not None and text_chars_test(tree.text(processed)):
                tree.clear_attrs(processed)
                if tree.tag(processed) == "div":
                    tree.set_tag(processed, "p")
                return processed
        return None

    def prune(self, root: int, allowed: frozenset[str] | set[str], keep_teasers: bool) -> int:
        """Remove unwanted sections and dense links using the focus contract."""
        tree = self.tree
        precise = self.options.focus == "precision"
        current = prune_unwanted_nodes(tree, root, OVERALL_DISCARD_RULES, True)
        if "graphic" not in allowed:
            current = prune_unwanted_nodes(tree, current, DISCARD_IMAGE_RULES, False)
        if self.options.focus != "recall":
            if not keep_teasers:
                current = prune_unwanted_nodes(tree, current, TEASER_DISCARD_RULES, False)
            if precise:
                current = prune_unwanted_nodes(tree, current, PRECISION_DISCARD_RULES, False)
        for _pass in range(2):
            for tag in ("div", "list", "p"):
                current = delete_by_link_density(tree, current, tag, tag == "div", precise)
        if "table" in allowed or precise:
            tables = [
                table
                for table in tree.collect_descendants_by_tag(current, ("table",))
                if link_density_test_tables(tree, table)
            ]
            tree.delete_elements_batch(tables, False)
        if precise:
            while tree.children(current) and tree.tag(tree.children(current)[-1]) == "head":
                tree.delete_element(tree.children(current)[-1], False)
            current = delete_by_link_density(tree, current, "head", False, True)
            current = delete_by_link_density(tree, current, "quote", False, True)
        return current

    def _recover(self, source: int, body: int, original_tags: set[str]) -> int:
        """Recover candidates with exact membership and a bounded substring scan."""
        tree = self.tree
        allowed = set(original_tags)
        search = {"code", "p", "quote", "table"}
        if self.options.focus == "recall":
            allowed.update(("div", "lb"))
            search.update(("div", "lb", "list"))
        root = self.prune(source, allowed, True)
        tree.strip_tags(root, ("span",) if "ref" in allowed else ("a", "ref", "span"))
        candidates = tree.collect_descendants_where(
            root,
            lambda node: (
                tree.tag(node) in search
                or (tree.tag(node) == "div" and "w3-code" in tree.get_or_empty(node, "class"))
            ),
        )
        texts = [elem_text(tree, node) for node in tree.children(body)]
        exact = set(texts)
        existing = "\n".join(filter(None, texts))
        length = len(existing)
        for node in candidates:
            processed = self._handle(node, allowed)
            if processed is None:
                continue
            text = elem_text(tree, processed)
            within = length <= DEDUPE_SCAN_CAP
            if text and (
                text in exact or (len(text) > MIN_DUPLICATE_LENGTH and within and text in existing)
            ):
                continue
            tree.append(body, processed)
            if within:
                existing += "\n" + text
                length += 1 + len(text)
            exact.add(text)
        return body

    def _body(self, root: int) -> tuple[int, str, set[str]]:
        """Select the primary candidate using ordered body rules."""
        tree = self.tree
        allowed = set(TAG_CATALOG)
        if self.options.include_tables:
            allowed.update(("table", "td", "th", "tr"))
        if self.options.include_images:
            allowed.add("graphic")
        if self.options.include_links:
            allowed.add("ref")
        body = tree.create("body")
        for rule in BODY_RULES:
            candidate = select_first(tree, root, rule)
            if candidate is None:
                continue
            selected = self.prune(candidate, allowed, False)
            if not tree.child_count(selected):
                continue
            paragraphs = sum(
                len(tree.itertext(node))
                for node in tree.collect_descendants_by_tag(document_root(tree, selected), ("p",))
            )
            if paragraphs < MIN_EXTRACTED_SIZE * (1 if self.options.focus == "precision" else 3):
                allowed.add("div")
            if "ref" not in allowed:
                tree.strip_tags(selected, ("ref",))
            if "span" not in allowed:
                tree.strip_tags(selected, ("span",))
            candidates = tree.collect_descendants(selected)
            if candidates and all(tree.tag(node) == "lb" for node in candidates):
                candidates = [selected]
            extracted = []
            for node in candidates:
                processed = self._handle(node, allowed)
                if processed is not None:
                    extracted.append(processed)
            tree.extend(body, extracted)
            while tree.children(body) and tree.tag(tree.children(body)[-1]) in {"head", "ref"}:
                tree.delete_element(tree.children(body)[-1], False)
            if sum(tree.tag(node) != "graphic" for node in tree.children(body)) > 1:
                break
        return body, strip_space(" ".join(tree.itertext_parts(body))), allowed

    def content(self, root: int) -> SelectedText:
        """Extract, recover and remove consecutive duplicate blocks."""
        tree = self.tree
        backup = tree.deep_copy(root)
        body, text, allowed = self._body(root)
        if not tree.child_count(body) or len(text) < MIN_EXTRACTED_SIZE:
            body = self._recover(backup, body, allowed)
            text = strip_space(" ".join(tree.itertext_parts(body)))
        previous: str | None = None
        duplicate = []
        for node in list(tree.children(body)):
            current = elem_text(tree, node)
            if current and current == previous and len(current) > MIN_DUPLICATE_LENGTH:
                duplicate.append(node)
            else:
                previous = current
        tree.delete_elements_batch(duplicate, False)
        tree.strip_elements(body, ("done",))
        tree.strip_tags(body, ("div",))
        return SelectedText(body, text, len(text))

    def comments(self, root: int) -> SelectedText:
        """Capture separate comment blocks with the same ordered selectors."""
        tree = self.tree
        body = tree.create("body")
        for rule in COMMENTS_RULES:
            candidate = select_first(tree, root, rule)
            if candidate is None:
                continue
            selected = prune_unwanted_nodes(tree, candidate, COMMENTS_DISCARD_RULES, False)
            tree.strip_tags(selected, ("a", "ref", "span"))
            extracted = []
            for node in tree.collect_descendants(selected):
                if tree.tag(node) not in TAG_CATALOG:
                    continue
                processed = handle_textnode(tree, node, True, False)
                if processed is not None:
                    tree.clear_attrs(processed)
                    extracted.append(processed)
            tree.extend(body, extracted)
            if tree.child_count(body):
                tree.delete_element(selected, False)
                break
        text = strip_space(" ".join(tree.itertext_parts(body)))
        return SelectedText(body, text, len(text))


def extract_content(tree: Tree, root: int, options: Options) -> SelectedText:
    """Run main-content extraction."""
    return MainExtractor(tree, options).content(root)


def extract_comments(tree: Tree, root: int, options: Options) -> SelectedText:
    """Run separate comment extraction."""
    return MainExtractor(tree, options).comments(root)
