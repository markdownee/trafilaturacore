# SPDX-License-Identifier: Apache-2.0
# HTML processing derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/htmlprocessing.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/htmlprocessing.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: added bottom-up density summaries, batched edits and lexical URL handling.
"""Extraction cleanup, link density and internal tag conversion."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from ._extract_options import Options
from ._selectors import Rule
from ._settings import CUT_EMPTY_ELEMS, MANUALLY_CLEANED, MANUALLY_STRIPPED, PRESERVE_IMG_CLEANING
from ._tree import Tree
from ._utils import LINK_FARM_RATIO, is_image_element, textfilter, trim, trim_or_none

REND_TAG_MAPPING = (
    ("em", "#i"),
    ("i", "#i"),
    ("b", "#b"),
    ("strong", "#b"),
    ("u", "#u"),
    ("kbd", "#t"),
    ("samp", "#t"),
    ("tt", "#t"),
    ("var", "#t"),
    ("sub", "#sub"),
    ("sup", "#sup"),
)


def tree_cleaning(tree: Tree, root: int, options: Options) -> int:
    """Apply the primary implementation's prune and unwrap policy."""
    remove, unwrap = list(MANUALLY_CLEANED), list(MANUALLY_STRIPPED)
    if options.include_tables:
        for node in tree.collect_descendants(root):
            if (
                tree.tag(node) == "figure"
                and tree.find_descendant(node, "table") is not None
                or tree.tag(node) == "table"
                and tree.get_or_empty(node, "role")
                in {
                    "presentation",
                    "none",
                }
            ):
                tree.set_tag(node, "div")
    else:
        remove.extend(("table", "td", "th", "tr"))
    if options.include_images:
        remove = [tag for tag in remove if tag not in PRESERVE_IMG_CLEANING]
        unwrap = [tag for tag in unwrap if tag != "img"]
    tree.strip_tags(root, unwrap)
    backup = (
        tree.deep_copy(root)
        if options.focus == "recall" and tree.find_descendant(root, "p") is not None
        else None
    )
    for tag in remove:
        tree.delete_all_with_tag_lxml(root, tag)
    selected = backup if backup is not None and tree.find_descendant(root, "p") is None else root
    return prune_html(tree, selected, options.focus)


def prune_html(tree: Tree, root: int, focus: str) -> int:
    """Drop empty leaves with focus-specific tail handling."""
    empty = tree.collect_descendants_where(
        root,
        lambda node: (
            tree.child_count(node) == 0
            and tree.text(node) is None
            and tree.tag(node) in CUT_EMPTY_ELEMS
        ),
    )
    tree.delete_elements_batch(empty, focus != "precision")
    return root


def prune_unwanted_nodes(tree: Tree, root: int, rules: Sequence[Rule], with_backup: bool) -> int:
    """Apply ordered rules and restore a backup when pruning removes almost all text."""
    original = len(tree.itertext(root)) if with_backup else 0
    backup = tree.deep_copy(root) if with_backup else None
    for rule in rules:
        tree.delete_elements_batch(
            [node for node in tree.iter_descendants(root) if rule(tree, node)], True
        )
    return backup if backup is not None and len(tree.itertext(root)) <= original / 7 else root


@dataclass
class TextMeasure:
    """Constant-size summary of normalized concatenated text."""

    length: int
    present: bool
    leading: bool
    trailing: bool


@dataclass
class Density:
    """Bottom-up link counts and normalized text lengths."""

    text: TextMeasure
    links: int = 0
    nonempty: int = 0
    short: int = 0
    link_chars: int = 0
    graphic: bool = False


def _measure(text: str | None) -> TextMeasure:
    """Measure a text slot using pinned whitespace semantics."""
    value = text or ""
    return TextMeasure(
        len(trim(value)),
        bool(value),
        bool(value and value[0].isspace()),
        bool(value and value[-1].isspace()),
    )


def _concatenate(left: TextMeasure, right: TextMeasure) -> TextMeasure:
    """Combine summaries without materializing descendant text."""
    if not left.present:
        return TextMeasure(right.length, right.present, right.leading, right.trailing)
    if not right.present:
        return left
    space = left.length > 0 and right.length > 0 and (left.trailing or right.leading)
    return TextMeasure(left.length + right.length + int(space), True, left.leading, right.trailing)


def _density_snapshot(tree: Tree, root: int) -> list[Density | None]:
    """Aggregate every relevant subtree once."""
    snapshot: list[Density | None] = [None] * len(tree.storage)
    for node in reversed(tree.collect_tree(root)):
        stats = Density(_measure(tree.text(node)))
        for child in tree.children(node):
            nested = snapshot[child]
            if nested is None:
                continue
            stats.text = _concatenate(
                _concatenate(stats.text, nested.text), _measure(tree.tail(child))
            )
            stats.links += nested.links
            stats.nonempty += nested.nonempty
            stats.short += nested.short
            stats.link_chars += nested.link_chars
            stats.graphic |= nested.graphic or tree.tag(child) == "graphic"
            if tree.tag(child) == "ref":
                stats.links += 1
                if nested.text.length > 0:
                    stats.nonempty += 1
                    stats.short += int(nested.text.length < 10)
                    stats.link_chars += nested.text.length
        snapshot[node] = stats
    return snapshot


def cached_trimmed_text_chars(tree: Tree, root: int) -> list[int | None]:
    """Cache each subtree's normalized text length."""
    return [
        stats.text.length if stats is not None else None for stats in _density_snapshot(tree, root)
    ]


def _density_decision(tree: Tree, node: int, stats: Density, precise: bool) -> tuple[bool, bool]:
    """Apply the primary implementation's pinned density thresholds."""
    if stats.links == 0 or stats.graphic:
        return False, False
    length = stats.text.length
    if (
        stats.links == 1
        and stats.link_chars > (10 if precise else 100)
        and stats.link_chars > length * 0.9
    ):
        return True, False
    last = tree.next_sibling(node) is None
    limit = (60 if last else 30) if tree.tag(node) == "p" else (300 if last else 100)
    if length < limit:
        dense = (
            stats.nonempty == 0
            or stats.link_chars > length * 0.8
            or (stats.nonempty > 1 and stats.short / stats.nonempty > 0.8)
        )
        return dense, True
    dense = (
        stats.links > 4
        and stats.link_chars > length * LINK_FARM_RATIO
        and stats.link_chars < 100 * stats.nonempty
    )
    return dense, dense


def link_density_test(tree: Tree, node: int, text: str, precise: bool) -> tuple[bool, list[str]]:
    """Return the density decision and collected link text where requested."""
    links = tree.collect_descendants_by_tag(node, ("ref",))
    if not links or tree.find_descendant(node, "graphic") is not None:
        return False, []
    texts = [value for link in links if (value := trim(tree.itertext(link)))]
    lengths = [len(value) for value in texts]
    measure = _measure(text)
    measure.length = len(text)
    stats = Density(
        measure, len(links), len(texts), sum(size < 10 for size in lengths), sum(lengths)
    )
    dense, collect = _density_decision(tree, node, stats, precise)
    return dense, texts if collect else []


def link_density_test_tables(tree: Tree, node: int) -> bool:
    """Apply the table-specific linked-text thresholds."""
    links = tree.collect_descendants_by_tag(node, ("ref",))
    if not links:
        return False
    length = len(trim(tree.itertext(node)))
    if length < 200:
        return False
    linked = sum(len(trim(tree.itertext(link))) for link in links)
    return linked > length * (0.8 if length < 1000 else 0.5)


def delete_by_link_density(
    tree: Tree, root: int, tag: str, backtracking: bool, precise: bool
) -> int:
    """Delete selected dense containers using one immutable density snapshot."""
    candidates = tree.collect_tree_where(root, lambda node: tree.tag(node) == tag)
    if not candidates:
        return root
    snapshot = _density_snapshot(tree, root)
    removed: list[int] = []
    for node in candidates:
        stats = snapshot[node]
        if stats is None:
            continue
        dense, collect = _density_decision(tree, node, stats, precise)
        backtrack = (
            backtracking
            and collect
            and stats.nonempty > 0
            and 0 < stats.text.length < (200 if precise else 100)
            and tree.child_count(node) >= (1 if precise else 3)
        )
        if not dense and not backtrack:
            continue
        parent = tree.parent(node)
        if tag == "p" and parent is not None and tree.tag(parent) in {"item", "td", "th"}:
            continue
        removed.append(node)
    tree.delete_elements_batch(removed, True)
    return root


def _empty_node(tree: Tree, node: int) -> bool:
    """Test consumed nodes and elements with no text, tail or children."""
    return tree.is_done(node) or (
        tree.child_count(node) == 0 and tree.text(node) is None and tree.tail(node) is None
    )


def handle_textnode(tree: Tree, node: int, comments_fix: bool, preserve_spaces: bool) -> int | None:
    """Normalize one candidate while retaining image and linebreak behavior."""
    if tree.tag(node) == "graphic" and is_image_element(tree, node):
        return node
    if _empty_node(tree, node):
        return None
    if not comments_fix and tree.tag(node) == "lb":
        if not preserve_spaces:
            tree.set_tail(node, trim_or_none(tree.tail(node)))
        return node
    if tree.text(node) is None and tree.child_count(node) == 0:
        tree.set_text(node, tree.tail(node))
        tree.set_tail(node, "")
        if comments_fix and tree.tag(node) == "lb":
            tree.set_tag(node, "p")
    if not preserve_spaces:
        tree.set_text(node, trim_or_none(tree.text(node)))
        if tree.tail(node):
            tree.set_tail(node, trim_or_none(tree.tail(node)))
    return None if not tree.text(node) and textfilter(tree, node) else node


def process_node(tree: Tree, node: int) -> int | None:
    """Normalize a generic extraction element."""
    if _empty_node(tree, node):
        return None
    tree.set_text(node, trim_or_none(tree.text(node)))
    tree.set_tail(node, trim_or_none(tree.tail(node)))
    if tree.tag(node) != "lb" and tree.text(node) is None and tree.tail(node) is not None:
        tree.set_text(node, tree.tail(node))
        tree.set_tail(node, None)
    if (tree.text(node) is not None or tree.tail(node) is not None) and textfilter(tree, node):
        return None
    return node


@dataclass
class UrlReference:
    """Lexical components, preserving spelling instead of applying WHATWG repairs."""

    scheme: str | None
    authority: str | None
    path: str
    query: str | None
    fragment: str | None


def _url_parts(value: str) -> UrlReference:
    """Split URL components with the frozen TypeScript adapter's grammar."""
    match = re.match(
        r"^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?://([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#([\s\S]*))?$",
        value,
    )
    if match is None:
        return UrlReference(None, None, value, None, None)
    return UrlReference(match[1], match[2] or None, match[3], match[4], match[5])


def _url_text(parts: UrlReference) -> str:
    """Serialize lexical components while omitting empty query/fragment delimiters."""
    prefix = (parts.scheme + ":" if parts.scheme is not None else "") + (
        "//" + parts.authority if parts.authority is not None else ""
    )
    slash = (
        "/" if parts.authority is not None and parts.path and not parts.path.startswith("/") else ""
    )
    return (
        prefix
        + slash
        + parts.path
        + ("?" + parts.query if parts.query else "")
        + ("#" + parts.fragment if parts.fragment else "")
    )


def _normalized_path(path: str, collapse: bool) -> str:
    """Resolve literal dot components and preserve the source trailing-slash rule."""
    pieces = path.split("/")
    if not collapse and "." not in pieces and ".." not in pieces:
        return path
    resolved: list[str] = []
    for piece in pieces:
        if not piece or piece == ".":
            continue
        if piece == "..":
            if resolved:
                resolved.pop()
        else:
            resolved.append(piece)
    value = ("/" if path.startswith("/") else "") + "/".join(resolved)
    if path.endswith(("/", "/.", "/..")) and not value.endswith("/"):
        value += "/"
    return value


def join_url_compat(base: str, target: str) -> str:
    """Translate the primary implementation's offline lexical URL join."""
    if not base or not target:
        return target or base
    relative, origin = _url_parts(target), _url_parts(base)
    if relative.scheme is not None:
        return target
    if relative.authority is not None:
        relative.scheme = origin.scheme
        return _url_text(relative)
    if not relative.path:
        origin.query = relative.query if relative.query is not None else origin.query
        origin.fragment = relative.fragment
        return _url_text(origin)
    directory = (
        "/"
        if origin.authority is not None and not origin.path
        else origin.path[: origin.path.rfind("/") + 1]
    )
    relative.path = (
        _normalized_path(relative.path, False)
        if relative.path.startswith("/")
        else _normalized_path(directory + relative.path, True)
    )
    relative.scheme, relative.authority = origin.scheme, origin.authority
    return _url_text(relative)


def fix_relative_urls(base: str, target: str) -> str:
    """Preserve cross-authority and template-value compatibility."""
    if target.startswith("{"):
        return target
    destination = _url_parts(target)
    if destination.authority is not None and destination.authority != _url_parts(base).authority:
        return "http:" + target if destination.scheme is None else target
    return join_url_compat(base, target)


def _conversion(tree: Tree, node: int) -> None:
    """Translate one HTML structure into the internal extraction vocabulary."""
    tag = tree.tag(node)
    if tag in {"dl", "ol", "ul"}:
        tree.set(node, "rend", tag)
        tree.set_tag(node, "list")
        count = 1
        for child in tree.collect_descendants_by_tag(node, ("dd", "dt", "li")):
            kind = tree.tag(child)
            if kind in {"dd", "dt"}:
                tree.set(child, "rend", f"{kind}-{count}")
                if kind == "dd":
                    count += 1
            tree.set_tag(child, "item")
    elif re.fullmatch(r"h[1-6]", tag):
        tree.clear_attrs(node)
        tree.set(node, "rend", tag)
        tree.set_tag(node, "head")
    elif tag in {"br", "hr"}:
        tree.set_tag(node, "lb")
    elif tag in {"pre", "blockquote", "q"}:
        code = False
        if tag == "pre":
            children = tree.children(node)
            code = len(children) == 1 and tree.tag(children[0]) == "span"
            spans = tree.collect_descendants_where(
                node,
                lambda child: (
                    tree.tag(child) == "span"
                    and tree.get_or_empty(child, "class").startswith("hljs")
                ),
            )
            for span in spans:
                tree.clear_attrs(span)
            code |= bool(spans) or any(
                indicator in (tree.text(node) or "") for indicator in ("{", '("', "('", "\n    ")
            )
        tree.set_tag(node, "code" if code else "quote")
    elif tag in {"del", "s", "strike"}:
        tree.set_tag(node, "del")
        tree.set(node, "rend", "overstrike")
    elif tag == "details":
        tree.set_tag(node, "div")
        for child in tree.collect_descendants_by_tag(node, ("summary",)):
            tree.set_tag(child, "head")


def convert_tags(tree: Tree, root: int, options: Options, url: str | None) -> int:
    """Apply links, formatting, block and image conversions in source order."""
    if options.include_links:
        parsed = _url_parts(url) if url is not None else None
        base = (
            f"{parsed.scheme}://{parsed.authority}"
            if parsed is not None and parsed.scheme is not None and parsed.authority is not None
            else None
        )
        for node in tree.collect_descendants_by_tag(root, ("a", "ref")):
            target = tree.get(node, "href")
            tree.set_tag(node, "ref")
            tree.clear_attrs(node)
            if target:
                tree.set(
                    node, "target", target if base is None else fix_relative_urls(base, target)
                )
    else:
        for node in tree.collect_descendants_by_tag(root, ("a",)):
            if any(tree.has_ancestor(node, tag) for tag in ("div", "li", "p")) or (
                options.include_tables and tree.has_ancestor(node, "table")
            ):
                tree.set_tag(node, "ref")
        tree.strip_tags(root, ("a",))
    for node in tree.collect_descendants_where(
        root,
        lambda child: (
            tree.tag(child) == "strong"
            and "schema-faq-question" in tree.get_or_empty(child, "class")
        ),
    ):
        tree.clear_attrs(node)
        tree.set(node, "rend", "h3")
        tree.set_tag(node, "head")
    empty = tree.collect_descendants_where(
        root,
        lambda node: (
            tree.tag(node) in {"sub", "sup"}
            and tree.text(node) is None
            and tree.child_count(node) == 0
        ),
    )
    tree.delete_elements_batch(empty, True)
    formatting = dict(REND_TAG_MAPPING)
    if options.include_formatting:
        for node in tree.collect_descendants_by_tag(root, tuple(formatting)):
            rend = formatting.get(tree.tag(node), "#i")
            tree.clear_attrs(node)
            tree.set(node, "rend", rend)
            tree.set_tag(node, "hi")
    else:
        tree.strip_tags(root, tuple(formatting))
    convertible = (
        "dl",
        "ol",
        "ul",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "br",
        "hr",
        "blockquote",
        "pre",
        "q",
        "del",
        "s",
        "strike",
        "details",
    )
    for node in tree.collect_descendants_by_tag(root, convertible):
        _conversion(tree, node)
    if options.include_images:
        for node in tree.collect_descendants_by_tag(root, ("img",)):
            tree.set_tag(node, "graphic")
        if options.include_links:
            claimed: set[int] = set()
            moves: list[tuple[int, list[int]]] = []
            for reference in tree.collect_descendants_by_tag(root, ("ref",)):
                graphics = []
                for graphic in tree.collect_descendants_by_tag(reference, ("graphic",)):
                    if graphic not in claimed:
                        claimed.add(graphic)
                        graphics.append(graphic)
                if graphics:
                    moves.append((reference, graphics))
            tree.move_groups_after(moves)
            tree.delete_elements_batch(
                [reference for reference, _ in moves if not trim(tree.itertext(reference))], True
            )
    return root
