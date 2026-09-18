# SPDX-License-Identifier: Apache-2.0
# Extraction stages derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/core.py::_forum_thread_page/_prepare_tree/_recall_retry/
#   trafilatura_sequence and bare_extraction's minimum-output check
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/core.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted extraction orchestration with result dataclasses and bounded work.
"""Native extraction cascade, preserving the narrow upstream forum exception."""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

from lxml.html import HtmlElement

from ._baseline import baseline, html2txt
from ._dom import arena_from_document
from ._extract_options import Options
from ._htmlprocessing import convert_tags, prune_unwanted_nodes, tree_cleaning
from ._main_extractor import SelectedText, elem_text, extract_comments, extract_content
from ._output import OutputBudget, convert_to_html, serialize_fragment
from ._selectors import REMOVE_COMMENTS_RULES
from ._settings import (
    ESCALATION_ACCEPT_RATIO,
    ESCALATION_MAX_LENGTH,
    ESCALATION_PAGE_SHARE,
    FORUM_SALVAGE_SCAN_BYTES,
    MIN_EXTRACTED_SIZE,
    MIN_OUTPUT_COMM_SIZE,
    MIN_OUTPUT_SIZE,
)
from ._tree import Tree
from ._utils import PY_SPACE_CLASS, strip_space

_FORUM_TYPE = re.compile('"@type"[' + PY_SPACE_CLASS + "]*:[" + PY_SPACE_CLASS + "]*")


@dataclass
class Extraction:
    """Unsanitized core fragments and internal extraction diagnostics."""

    content_html: str = ""
    comments_html: str = ""
    text_length: int = 0
    fallback_used: bool = False
    warnings: list[str] = field(default_factory=list)


@dataclass
class SequenceResult:
    """Selection before internal-tag conversion and output serialization."""

    postbody: int
    temp_text: str
    len_text: int
    commentsbody: int
    len_comments: int
    fallback_used: bool
    warnings: list[str]


def has_forum_declaration(source: str) -> bool:
    """Recognize the pinned raw declaration grammar with forward-only cursors."""
    literal = '"DiscussionForumPosting"'
    if literal not in source:
        return False
    close = value = 0
    missing = len(source) + 1
    for match in _FORUM_TYPE.finditer(source):
        start = match.end()
        if source.startswith(literal, start):
            return True
        if source[start : start + 1] != "[":
            continue
        if close <= start:
            position = source.find("]", start + 1)
            close = missing if position < 0 else position
        if value <= start:
            position = source.find(literal, start + 1)
            value = missing if position < 0 else position
        if value < close:
            return True
    return False


def _is_forum(tree: Tree, root: int) -> bool:
    """Read raw JSON-LD only; the metadata sidecar never controls extraction."""
    return tree.any_descendant(
        root,
        lambda node: (
            tree.tag(node) == "script"
            and tree.get(node, "type") == "application/ld+json"
            and has_forum_declaration(tree.text(node) or "")
        ),
    )


def _prepared(tree: Tree, root: int, options: Options) -> tuple[int, int]:
    """Keep the pre-conversion backup required by forum and recall handling."""
    cleaned = tree_cleaning(tree, tree.deep_copy(root), options)
    backup = tree.deep_copy(cleaned)
    return convert_tags(tree, cleaned, options, options.url), backup


def _utf16_units(value: str) -> int:
    """Retain the primary implementation's substring-work accounting unit."""
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def missing_forum_posts(tree: Tree, body: int, comments: int, budget: int) -> list[int]:
    """Retain unmatched posts, conservatively keeping them after scan exhaustion."""
    paragraphs = [text for node in tree.children(body) if (text := elem_text(tree, node))]
    exact = set(paragraphs)
    whole = "\n".join(paragraphs)
    whole_units = _utf16_units(whole)
    selected = []
    remaining = budget
    for node in tree.children(comments):
        text = elem_text(tree, node)
        if not text or text in exact:
            continue
        units = _utf16_units(text)
        if units > whole_units:
            selected.append(node)
            continue
        cost = units + whole_units
        if cost > remaining:
            remaining = 0
            selected.append(node)
        else:
            remaining -= cost
            if text not in whole:
                selected.append(node)
    return selected


def trafilatura_sequence(tree: Tree, root: int, options: Options) -> SequenceResult:
    """Run the translated fast-path extraction cascade."""
    forum = _is_forum(tree, root)

    def prune(node: int) -> int:
        """Prune comments from a private copy."""
        return prune_unwanted_nodes(tree, tree.deep_copy(node), REMOVE_COMMENTS_RULES, False)

    source = (
        prune(root)
        if not options.include_comments and (options.focus == "precision" or not forum)
        else root
    )
    working, backup = _prepared(tree, source, options)
    comments = SelectedText(tree.create("body"), "", 0)
    saved_posts: int | None = None
    if options.include_comments:
        comments = extract_comments(tree, working, options)
        if forum and comments.length > 0:
            saved_posts = comments.body
            comments = SelectedText(tree.create("body"), "", 0)
            working = convert_tags(tree, tree.deep_copy(backup), options, options.url)
    if options.focus == "precision" and not forum:
        working = prune_unwanted_nodes(tree, working, REMOVE_COMMENTS_RULES, False)
    selected = extract_content(tree, working, options)
    warnings: list[str] = []
    fallback_used = False
    if selected.length < MIN_EXTRACTED_SIZE and options.focus != "precision":
        selected = baseline(tree, source)
        saved_posts = None
        fallback_used = True
        warnings.append("baseline-rescue")
    if (
        options.focus == "balanced"
        and 0 < selected.length < ESCALATION_MAX_LENGTH
        and selected.length < ESCALATION_PAGE_SHARE * len(html2txt(tree, source, True))
    ):
        recall = replace(options, focus="recall")
        candidate_root, _backup = _prepared(tree, source if forum else prune(source), recall)
        candidate = extract_content(tree, candidate_root, recall)
        if (
            candidate.length >= MIN_EXTRACTED_SIZE
            and candidate.length > ESCALATION_ACCEPT_RATIO * selected.length
        ):
            selected = candidate
            saved_posts = None
            fallback_used = True
            warnings.append("recall-escalation")
    if saved_posts is not None:
        missing = missing_forum_posts(tree, selected.body, saved_posts, FORUM_SALVAGE_SCAN_BYTES)
        if missing:
            tree.extend(selected.body, missing)
            text = strip_space(" ".join(tree.itertext_parts(selected.body)))
            selected = SelectedText(selected.body, text, len(text))
            warnings.append("thread-forum-salvage")
    return SequenceResult(
        selected.body,
        selected.text,
        selected.length,
        comments.body,
        comments.length,
        fallback_used,
        warnings,
    )


def extract_document(document: HtmlElement, options: Options) -> Extraction:
    """Select and serialize an already-preflighted document before mandatory cleaning."""
    tree, root = arena_from_document(document)
    selected = trafilatura_sequence(tree, root, options)
    if selected.len_text < MIN_OUTPUT_SIZE and selected.len_comments < MIN_OUTPUT_COMM_SIZE:
        return Extraction()
    budget = OutputBudget()
    convert_to_html(tree, selected.postbody)
    body = serialize_fragment(tree, selected.postbody, budget)
    comments = ""
    if selected.len_comments > 0:
        convert_to_html(tree, selected.commentsbody)
        comments = serialize_fragment(tree, selected.commentsbody, budget)
    return Extraction(body, comments, selected.len_text, selected.fallback_used, selected.warnings)
