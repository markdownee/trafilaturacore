# SPDX-License-Identifier: Apache-2.0
# Baseline recovery derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/baseline.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/baseline.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted JSON/lxml traversal, incremental deduplication and resource errors.
"""Ordered extraction rescue strategies translated from the primary implementation."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable

from ._dom import parse_document
from ._errors import ResourceLimitError
from ._main_extractor import SelectedText
from ._selectors import BASIC_CLEAN_RULES
from ._settings import BLOCK_ELEMS, DEDUPE_SCAN_CAP, MIN_CONTENT_LENGTH, MIN_DUPLICATE_LENGTH
from ._tree import Tree
from ._utils import PY_SPACE_CLASS, html_unescape, remove_control_characters, trim


def _object(value: object) -> dict[str, object]:
    """Read a JSON object without treating arrays as objects."""
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list[object]:
    """Normalize optional JSON values into a sequence."""
    return [] if value is None else value if isinstance(value, list) else [value]


def _json(text: str, relaxed: bool = False) -> object:
    """Match non-finite-number and optional control-character JSON adapters."""
    try:
        return json.loads(text, strict=not relaxed, parse_constant=lambda _value: None)
    except RecursionError as error:
        raise ResourceLimitError("JSON nesting exceeds the native parser limit") from error
    except ValueError:
        return None


def _walk_json(value: object, bodies: list[str], teasers: list[str]) -> None:
    """Traverse JSON containers in the primary implementation's depth-first order."""
    pending = list(reversed(_list(value)))
    while pending:
        item = _object(pending.pop())
        for key in ("articleBody", "reviewBody"):
            text = item.get(key)
            if isinstance(text, str) and text:
                bodies.append(text)
        for key in ("recipeInstructions", "step"):
            for step in _list(item.get(key)):
                if isinstance(step, str):
                    bodies.append(step)
                    continue
                entry = _object(step)
                text = entry.get("text")
                if isinstance(text, str):
                    bodies.append(text)
                for child in _list(entry.get("itemListElement")):
                    text = _object(child).get("text")
                    if isinstance(text, str):
                        bodies.append(text)
        answer = _object(item.get("acceptedAnswer")).get("text")
        if isinstance(answer, str):
            bodies.append(answer)
        content_type = json.dumps(item.get("@type") or "", ensure_ascii=False)
        description = item.get("description")
        if ("Product" in content_type or "VideoObject" in content_type) and isinstance(
            description, str
        ):
            teasers.append(description)
        pending.extend(reversed(_list(item.get("mainEntity"))))
        pending.extend(reversed(_list(item.get("@graph"))))


def discourse_texts(tree: Tree, root: int) -> list[str]:
    """Read embedded Discourse cooked posts without fetching."""
    node = tree.find_descendant_where(
        root,
        lambda candidate: (
            tree.tag(candidate) == "div" and tree.get(candidate, "id") == "data-preloaded"
        ),
    )
    values = {} if node is None else _object(_json(tree.get_or_empty(node, "data-preloaded")))
    texts = []
    for key, raw in values.items():
        if not key.startswith("topic_") or not isinstance(raw, str):
            continue
        posts = _object(_object(_json(raw)).get("post_stream")).get("posts")
        for post in _list(posts):
            text = _object(post).get("cooked")
            if isinstance(text, str):
                texts.append(text)
    return texts


JSON_HOOKS = (
    "articleBody",
    "reviewBody",
    "recipeInstructions",
    "acceptedAnswer",
    '"Product"',
    '"VideoObject"',
    '"HowTo"',
)


def _embedded(tree: Tree, root: int) -> tuple[list[str], list[str]]:
    """Gather body and teaser candidates from declared embedded data."""
    bodies: list[str] = []
    teasers: list[str] = []
    for node in tree.iter_descendants(root):
        if tree.tag(node) != "script" or tree.get(node, "type") != "application/ld+json":
            continue
        text = tree.text(node)
        if text and any(hook in text for hook in JSON_HOOKS):
            _walk_json(_json(text, True), bodies, teasers)
    bodies.extend(discourse_texts(tree, root))
    return bodies, teasers


def basic_cleaning(tree: Tree, root: int) -> None:
    """Remove basic boilerplate with batched parent compaction."""
    for rule in BASIC_CLEAN_RULES:
        tree.delete_elements_batch(
            [node for node in tree.iter_descendants(root) if rule(tree, node)], True
        )


_HTML_NAMES = (
    "a|abbr|address|article|aside|b|blockquote|body|br|caption|cite|code|dd|del|div|dl|dt|em|"
    "figcaption|figure|footer|h[1-6]|head|header|hr|html|i|img|ins|kbd|li|main|mark|nav|ol|p|pre|"
    "q|quote|s|section|small|span|strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|time|title|tr|u|ul"
)
_MARKUP = re.compile(
    "</(" + _HTML_NAMES + ")>|<(" + _HTML_NAMES + ")([" + PY_SPACE_CLASS + "][^<>=]*=[^<>]*)?/?>",
    re.IGNORECASE | re.ASCII,
)


def _rendered(raw: str) -> str:
    """Render recognized embedded HTML only after its own resource preflight."""
    text = remove_control_characters(html_unescape(raw))
    if _MARKUP.search(text):
        tree, root = parse_document("<div>" + text + "</div>")
        return trim(tree.itertext(root))
    return trim(text)


def _attempt(tree: Tree, texts: Iterable[str], dedupe: bool) -> SelectedText | None:
    """Build a candidate body using a bounded incremental duplicate check."""
    body = tree.create("body")
    text = ""
    length = 0
    for value in texts:
        paragraph = remove_control_characters(value)
        if not paragraph:
            continue
        size = len(paragraph)
        if (
            dedupe
            and size > MIN_DUPLICATE_LENGTH
            and length <= DEDUPE_SCAN_CAP
            and paragraph in text
        ):
            continue
        tree.set_text(tree.create_sub(body, "p"), paragraph)
        if text:
            text += "\n"
            length += 1
        text += paragraph
        length += size
    return SelectedText(body, text, length) if length > MIN_CONTENT_LENGTH else None


def baseline(tree: Tree, source: int) -> SelectedText:
    """Try embedded bodies, articles, paragraphs, teasers and finally document text."""
    root = tree.deep_copy(source)
    bodies, teasers = _embedded(tree, root)
    from_json = _attempt(tree, (_rendered(value) for value in bodies), True)
    if from_json is not None:
        return from_json
    basic_cleaning(tree, root)
    articles: list[tuple[str, int]] = []
    largest = 0
    for node in tree.iter_descendants(root):
        if tree.tag(node) != "article" or tree.has_ancestor(node, "article"):
            continue
        text = trim(tree.itertext(node))
        length = len(text)
        if length > MIN_CONTENT_LENGTH:
            articles.append((text, length))
            largest = max(largest, length)
    if articles:
        from_articles = _attempt(
            tree, (text for text, length in articles if length >= largest / 5), False
        )
        if from_articles is not None:
            return from_articles
    tags = {"blockquote", "code", "p", "pre", "q", "quote"}
    paragraphs = [
        trim(tree.itertext(node))
        for node in tree.collect_descendants_where(root, lambda node: tree.tag(node) in tags)
    ]
    from_paragraphs = _attempt(tree, paragraphs, True)
    if from_paragraphs is not None:
        return from_paragraphs
    teaser = _attempt(tree, (_rendered(value) for value in teasers), True)
    body = tree.create("body")
    original_body = tree.find_descendant(root, "body")
    if original_body is not None:
        parts = filter(None, (trim(value) for value in tree.itertext_parts(original_body)))
        text = remove_control_characters("\n".join(parts))
        tree.set_text(tree.create_sub(body, "p"), text)
        if teaser is None or len(text) >= teaser.length:
            return SelectedText(body, text, len(text))
    return teaser if teaser is not None else SelectedText(body, "", 0)


def html2txt(tree: Tree, source: int, clean: bool) -> str:
    """Keep block boundaries separate when measuring the whole page."""
    copied = tree.deep_copy(source)
    body = tree.find_descendant(copied, "body")
    if body is None:
        body = copied
    if clean:
        basic_cleaning(tree, body)
    for node in tree.iter_tree(body):
        if tree.tag(node) in BLOCK_ELEMS:
            tree.set_text(node, " " + remove_control_characters(tree.text(node) or ""))
            tree.set_tail(node, " " + remove_control_characters(tree.tail(node) or ""))
    return trim(tree.itertext(body))
