# SPDX-License-Identifier: Apache-2.0
# Extraction selectors derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/xpaths.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/xpaths.py
#   trafilatura/settings.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/settings.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# The Rule/Query design passes through go-trafilatura (Apache-2.0), revision
# 67c3f2a1ca17e9a7b9643239d88d5fe25a36b6ed:
#   internal/selector/selector.go
#   https://github.com/markusmobius/go-trafilatura/blob/67c3f2a1ca17e9a7b9643239d88d5fe25a36b6ed/internal/selector/selector.go
# Copyright (C) 2021 Markus Mobius. Apache-2.0.
# Modified: translated extraction rules to Python predicates with ordered attributes
# and ECMAScript-compatible regex handling.
"""Ordered extraction predicates from the frozen primary implementation."""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

from ._settings import COOKIE_CONSENT_RE
from ._tree import Tree
from ._utils import PY_SPACE_CLASS

Rule = Callable[[Tree, int], bool]


def source_first_attr(tree: Tree, identifier: int, names: Sequence[str]) -> str:
    """Return the first requested attribute in original source order."""
    return next((value for name, value in tree.node(identifier).attrs.items() if name in names), "")


def translate(value: str, source: str, target: str) -> str:
    """Apply XPath translate's first-position character mapping."""
    mapping = {char: target[index : index + 1] for index, char in reversed(list(enumerate(source)))}
    return "".join(mapping.get(char, char) for char in value)


class Pattern:
    """Use the frozen ASCII policy patterns with JavaScript Unicode case folding."""

    def __init__(self, source: str, flags: str = "") -> None:
        """Bind whitespace explicitly instead of consulting the host Unicode data."""
        self.insensitive = "i" in flags
        self.expression = re.compile(
            source.replace(r"\s", "[" + PY_SPACE_CLASS + "]"),
            re.IGNORECASE | re.ASCII if self.insensitive else 0,
        )

    def test(self, value: str) -> bool:
        """The only non-ASCII folds to ASCII under ECMAScript /iu are long s and Kelvin."""
        if self.insensitive:
            value = value.replace("\u017f", "s").replace("\u212a", "k")
        return self.expression.search(value) is not None


PATTERN_0 = Pattern(
    "(?:entry|article|art)-content|article__content|article(?:-|__)?body|articleBody|body-text", ""
)

PATTERN_1 = Pattern(
    (
        "post[-_]text|post-body|post-?entry|post[-_]?content|pos"
        "tContent|post_inner_wrapper|article-?text|articleText|("
        "?:entry|page|text|article|art)-content|article__content"
        "|article(?:-|__)?body|articleBody|ArticleContent|body-t"
        "ext|article__container"
    ),
    "",
)

PATTERN_2 = Pattern("^primary|story-body", "")

PATTERN_3 = Pattern("fulltext", "i")

PATTERN_4 = Pattern(
    (
        "^article |post-bodycopy|story-?content|(?:theme|blog|se"
        "ction|single)-content|single-post|main-column|wpb_text_"
        "column|story-body|field-body"
    ),
    "",
)

PATTERN_5 = Pattern("content-main|content-body|contentBody", "")

PATTERN_6 = Pattern("content[-_]main|content(?:-|__)body", "")

PATTERN_7 = Pattern("comment-?list", "")

PATTERN_8 = Pattern("comment-page|comments-content|post-comments", "")

PATTERN_9 = Pattern("^comment[s-]", "")

PATTERN_10 = Pattern("^Comments|article-comments", "")

PATTERN_11 = Pattern("^(?:comol|disqus_thread|dsq-comments)", "")

PATTERN_12 = Pattern("^(?:[Cc]omment|comol|disqus_thread|dsq-comments)", "")

PATTERN_13 = Pattern("^[Cc]omment|(?:article|post)-comments", "")

PATTERN_14 = Pattern("cookie", "")

PATTERN_15 = Pattern(
    (
        "^shar|social|viral|newsletter|syndication|tags|sidebar|"
        "banner|bread-?crumb|button|author|^(?:jp-|dpsp-content)"
        "|bmdh|footer|Footer|share|Share|nav|Nav|menu|related|me"
        "ssage-container|premium"
    ),
    "",
)

PATTERN_16 = Pattern(
    (
        "^shar|social|viral|newsletter|syndication|tags|sidebar|"
        "banner|bread-?crumb|button|author|^(?:nav|post-nav|Zend"
        "eskForm)|subnav|avigation|navbar|navbox|menu|bar| ad |-"
        "ad-|outbrain|taboola|criteo|paid-?content|widget|footer"
        "|Footer|byline|Byline|share-|sociable|embedded|embed|ta"
        "g-list|consent|modal-content|permission|elated|next-|-s"
        "tories|most-popular|meta|rating|attachment|timestamp|us"
        "er-info|user-profile|-icon|article-infos|message-contai"
        "ner|slide|viewport|overlay|options|expand|obfuscated|bl"
        "urred|mol-factbox|yin|zlylin|nfoline"
    ),
    "",
)

PATTERN_17 = Pattern("hidden", "")

PATTERN_18 = Pattern("reader-comments|akismet", "")

PATTERN_19 = Pattern(
    (
        "^hide-|comments-title|nocomments|-reply-|message|akisme"
        "t|suggest-links|-hide-|hide-print| hidden| hide|noprint"
        "|notloaded"
    ),
    "",
)

PATTERN_20 = Pattern("(^|\\s)link(\\s|$)", "")

PATTERN_21 = Pattern("comments-title|nocomments|-reply-|message|signin", "")

PATTERN_22 = Pattern("^reply-|akismet", "")

BODY_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(
        (
            (((tree.tag(id) == "article") or (tree.tag(id) == "div")) or (tree.tag(id) == "main"))
            or (tree.tag(id) == "section")
        )
        and (
            (
                (
                    (
                        ((tree.get(id, "class") == "post") or (tree.get(id, "class") == "entry"))
                        or (tree.get(id, "itemprop") == "articleBody")
                    )
                    or (tree.get(id, "id") == "articleContent")
                )
                or PATTERN_0.test(tree.get_or_empty(id, "id"))
            )
            or PATTERN_1.test(tree.get_or_empty(id, "class"))
        )
    ),
    lambda tree, id: bool(tree.tag(id) == "article"),
    lambda tree, id: bool(
        (
            (((tree.tag(id) == "article") or (tree.tag(id) == "div")) or (tree.tag(id) == "main"))
            or (tree.tag(id) == "section")
        )
        and (
            (
                (
                    (
                        (
                            (
                                (
                                    (
                                        (
                                            (
                                                (tree.get(id, "role") == "article")
                                                or (tree.get(id, "id") == "article")
                                            )
                                            or (tree.get(id, "id") == "story")
                                        )
                                        or (tree.get(id, "class") == "postarea")
                                    )
                                    or (tree.get(id, "class") == "art-postcontent")
                                )
                                or (tree.get(id, "class") == "text")
                            )
                            or (tree.get(id, "class") == "cell")
                        )
                        or (tree.get(id, "class") == "story")
                    )
                    or PATTERN_2.test(tree.get_or_empty(id, "id"))
                )
                or PATTERN_3.test(tree.get_or_empty(id, "class"))
            )
            or PATTERN_4.test(tree.get_or_empty(id, "class"))
        )
    ),
    lambda tree, id: bool(
        (
            (((tree.tag(id) == "article") or (tree.tag(id) == "div")) or (tree.tag(id) == "main"))
            or (tree.tag(id) == "section")
        )
        and (
            (
                (
                    (
                        (
                            (
                                (tree.get(id, "id") == "content")
                                or (tree.get(id, "class") == "content")
                            )
                            or PATTERN_5.test(tree.get_or_empty(id, "id"))
                        )
                        or PATTERN_6.test(tree.get_or_empty(id, "class"))
                    )
                    or ("main-content" in translate(tree.get_or_empty(id, "id"), "CM", "cm"))
                )
                or ("main-content" in translate(tree.get_or_empty(id, "class"), "CM", "cm"))
            )
            or ("page-content" in translate(tree.get_or_empty(id, "class"), "CP", "cp"))
        )
    ),
    lambda tree, id: bool(
        (
            (
                ((tree.tag(id) == "article") or (tree.tag(id) == "div"))
                or (tree.tag(id) == "section")
            )
            and (
                (
                    tree.get_or_empty(id, "class").startswith("main")
                    or tree.get_or_empty(id, "id").startswith("main")
                )
                or tree.get_or_empty(id, "role").startswith("main")
            )
        )
        or (tree.tag(id) == "main")
    ),
)

COMMENTS_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(
        (((tree.tag(id) == "div") or (tree.tag(id) == "list")) or (tree.tag(id) == "section"))
        and (
            PATTERN_7.test(source_first_attr(tree, id, ["id", "class"]))
            or PATTERN_8.test(tree.get_or_empty(id, "class"))
        )
    ),
    lambda tree, id: bool(
        (((tree.tag(id) == "div") or (tree.tag(id) == "section")) or (tree.tag(id) == "list"))
        and (
            PATTERN_9.test(source_first_attr(tree, id, ["id", "class"]))
            or PATTERN_10.test(tree.get_or_empty(id, "class"))
        )
    ),
    lambda tree, id: bool(
        (((tree.tag(id) == "div") or (tree.tag(id) == "section")) or (tree.tag(id) == "list"))
        and PATTERN_11.test(tree.get_or_empty(id, "id"))
    ),
    lambda tree, id: bool(
        ((tree.tag(id) == "div") or (tree.tag(id) == "section"))
        and (
            tree.get_or_empty(id, "id").startswith("social")
            or ("comment" in tree.get_or_empty(id, "class"))
        )
    ),
)

REMOVE_COMMENTS_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(
        (
            (((tree.tag(id) == "div") or (tree.tag(id) == "list")) or (tree.tag(id) == "section"))
            or (tree.tag(id) == "details")
        )
        and (
            PATTERN_12.test(tree.get_or_empty(id, "id"))
            or PATTERN_13.test(tree.get_or_empty(id, "class"))
        )
    ),
)

OVERALL_DISCARD_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(
        (
            (
                (
                    (
                        ((tree.tag(id) == "div") or (tree.tag(id) == "item"))
                        or (tree.tag(id) == "list")
                    )
                    or (tree.tag(id) == "p")
                )
                or (tree.tag(id) == "section")
            )
            or (tree.tag(id) == "span")
        )
        and (
            (
                (
                    (
                        (
                            (tree.get(id, "data-lp-replacement-content") is not None)
                            or ("nav" in translate(tree.get_or_empty(id, "role"), "N", "n"))
                        )
                        or ("MostPopularStories" in tree.get_or_empty(id, "data-component"))
                    )
                    or PATTERN_14.test(source_first_attr(tree, id, ["id", "class"]))
                )
                or PATTERN_15.test(tree.get_or_empty(id, "id"))
            )
            or PATTERN_16.test(tree.get_or_empty(id, "class"))
        )
    ),
    lambda tree, id: bool(
        (
            (
                (
                    (
                        (
                            (
                                (tree.get(id, "class") == "comments-title")
                                or source_first_attr(tree, id, ["id", "class"]).startswith("reply-")
                            )
                            or PATTERN_17.test(source_first_attr(tree, id, ["id", "style"]))
                        )
                        or ("display:none" in tree.get_or_empty(id, "style"))
                    )
                    or ("display: none" in tree.get_or_empty(id, "style"))
                )
                or PATTERN_18.test(tree.get_or_empty(id, "id"))
            )
            or PATTERN_19.test(tree.get_or_empty(id, "class"))
        )
        or (tree.get(id, "aria-hidden") == "true")
    ),
)

TEASER_DISCARD_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(
        (
            (
                (
                    (
                        ((tree.tag(id) == "div") or (tree.tag(id) == "item"))
                        or (tree.tag(id) == "list")
                    )
                    or (tree.tag(id) == "p")
                )
                or (tree.tag(id) == "section")
            )
            or (tree.tag(id) == "span")
        )
        and (
            ("teaser" in translate(tree.get_or_empty(id, "id"), "T", "t"))
            or ("teaser" in translate(tree.get_or_empty(id, "class"), "T", "t"))
        )
    ),
)

PRECISION_DISCARD_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(tree.tag(id) == "header"),
    lambda tree, id: bool(
        (
            (
                (
                    (
                        ((tree.tag(id) == "div") or (tree.tag(id) == "item"))
                        or (tree.tag(id) == "list")
                    )
                    or (tree.tag(id) == "p")
                )
                or (tree.tag(id) == "section")
            )
            or (tree.tag(id) == "span")
        )
        and (
            (
                ("bottom" in source_first_attr(tree, id, ["id", "class"]))
                or PATTERN_20.test(source_first_attr(tree, id, ["id", "class"]))
            )
            or ("border" in tree.get_or_empty(id, "style"))
        )
    ),
)

DISCARD_IMAGE_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(
        (
            (
                (
                    (
                        ((tree.tag(id) == "div") or (tree.tag(id) == "item"))
                        or (tree.tag(id) == "list")
                    )
                    or (tree.tag(id) == "p")
                )
                or (tree.tag(id) == "section")
            )
            or (tree.tag(id) == "span")
        )
        and (
            ("caption" in tree.get_or_empty(id, "id"))
            or ("caption" in tree.get_or_empty(id, "class"))
        )
    ),
)

COMMENTS_DISCARD_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(
        ((tree.tag(id) == "div") or (tree.tag(id) == "section"))
        and tree.get_or_empty(id, "id").startswith("respond")
    ),
    lambda tree, id: bool((tree.tag(id) == "cite") or (tree.tag(id) == "quote")),
    lambda tree, id: bool(
        (
            (
                (tree.get(id, "class") == "comments-title")
                or ("display:none" in tree.get_or_empty(id, "style"))
            )
            or PATTERN_21.test(tree.get_or_empty(id, "class"))
        )
        or PATTERN_22.test(source_first_attr(tree, id, ["id", "class"]))
    ),
)

COOKIE = Pattern(COOKIE_CONSENT_RE, "i")

BASIC_TAGS = frozenset(["aside", "fencedframe", "footer", "script", "style", "svg", "template"])

BASIC_CLEAN_RULES: tuple[Rule, ...] = (
    lambda tree, id: bool(
        (
            (
                (tree.tag(id) in BASIC_TAGS)
                or (
                    (tree.tag(id) == "div")
                    and ("footer" in source_first_attr(tree, id, ["class", "id"]))
                )
            )
            or COOKIE.test(tree.get_or_empty(id, "class"))
        )
        or COOKIE.test(tree.get_or_empty(id, "id"))
    ),
)


def select_first(tree: Tree, root: int, rule: Rule) -> int | None:
    """Probe one ordered rule against descendants."""
    return tree.find_descendant_where(root, lambda identifier: rule(tree, identifier))
