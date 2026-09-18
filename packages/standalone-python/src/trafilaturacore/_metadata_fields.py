# SPDX-License-Identifier: Apache-2.0
# Metadata field extraction derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/metadata.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
#   trafilatura/xpaths.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/xpaths.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted selector/field tables, merge stages and lxml text access.
"""DOM fields and meta-tag precedence translated from the primary engine."""

from __future__ import annotations

import re
from copy import deepcopy

from lxml.html import HtmlElement

from ._metadata_authors import normalize_authors
from ._metadata_dom import content_root, iter_text, query, query_all, text_content
from ._metadata_text import line_processing, string_value, strip_html_tags
from ._metadata_url import is_valid_url
from ._unicode import first_is_upper
from ._unicode import title as title_case
from ._utils import html_unescape, trim

AUTHOR_DISCARD = (
    'a[id="comments"], div[id="comments"], section[id="comme'
    'nts"], span[id="comments"], a[class="comments"], div[cl'
    'ass="comments"], section[class="comments"], span[class='
    '"comments"], a[class="title"], div[class="title"], sect'
    'ion[class="title"], span[class="title"], a[class="date"'
    '], div[class="date"], section[class="date"], span[class'
    '="date"], [id*="comment" i], [id*="ProductReviews" i], '
    '[class*="comment" i], [class*="sidebar" i], [class*="is'
    '-hidden" i], [class*="quote" i], [class*="embedly-insta'
    'gram" i], [class*="article-share" i], [class*="article-'
    'support" i], [class*="print" i], [class*="category" i],'
    ' [class*="meta-date" i], [class*="meta-reviewer" i], [d'
    'ata-component*="Figure" i], time, figure'
)

AUTHOR_SELECTORS = tuple(
    [
        (
            'a[rel="author" i], address[rel="author" i], div[rel="au'
            'thor" i], link[rel="author" i], p[rel="author" i], span'
            '[rel="author" i], strong[rel="author" i], a[id="author"'
            '], div[id="author"], p[id="author"], span[id="author"],'
            ' strong[id="author"], a[class="author"], div[class="aut'
            'hor"], p[class="author"], span[class="author"], strong['
            'class="author"], [itemprop="author name"], [data-testid'
            '="AuthorCard"], [data-testid="AuthorURL"], a[class*="au'
            'thor-name" i], span[class*="author-name" i], a[class*="'
            'authorname" i], span[class*="authorname" i], div[class*'
            '="author-name" i], p[class*="author-name" i], strong[cl'
            'ass*="author-name" i], author'
        ),
        (
            'a[class="byline"], div[class="byline"], h3[class="bylin'
            'e"], h4[class="byline"], p[class="byline"], span[class='
            '"byline"], [class="username"], [class="byl"], [class="B'
            'BL"], [itemprop*="author" i], [id*="author" i], [class*'
            '="author" i], [class*="channel-name" i], [class*="submi'
            'tted-by" i], [class*="posted-by" i], [class*="journalis'
            't-name" i]'
        ),
        (
            '[data-component*="Byline" i], [itemprop*="author" i], ['
            'id*="author" i], [class*="author" i], [class*="screenna'
            'me" i], [class*="writer" i], [class*="byline" i]'
        ),
    ]
)

TITLE_SELECTORS = tuple(
    [
        (
            'h1[class*="post-title" i], h2[class*="post-title" i], h'
            '1[class*="entry-title" i], h2[class*="entry-title" i], '
            'h1[class*="article-title" i], h2[class*="article-title"'
            ' i], h1[class*="post__title" i], h2[class*="post__title'
            '" i], h1[class*="headline" i], h2[class*="headline" i],'
            ' h1[id*="headline" i], h2[id*="headline" i], h1[itempro'
            'p*="headline" i], h2[itemprop*="headline" i]'
        ),
        '[class="entry-title"], [class="post-title"]',
        (
            'h1[class*="title" i], h2[class*="title" i], h3[class*="'
            'title" i], h1[id*="title" i], h2[id*="title" i], h3[id*'
            '="title" i]'
        ),
    ]
)

TITLE_SPLIT = re.compile(
    "^(.+)?[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u20"
    "00-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+[–•·—|⁄*⋆~‹«<›"
    "»>:-][\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u200"
    "0-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+(.+)$"
)

CATEGORY_SELECTORS = tuple(
    [
        (
            'div[class^="post-info" i] a[href], div[class^="postinfo'
            '" i] a[href], div[class^="post-meta" i] a[href], div[cl'
            'ass^="postmeta" i] a[href], div[class^="meta" i] a[href'
            '], div[class^="entry-meta" i] a[href], div[class^="entr'
            'y-info" i] a[href], div[class^="entry-utility" i] a[hre'
            'f], div[id^="postpath"] a[href]'
        ),
        (
            'p[class^="postmeta"] a[href], p[class^="entry-categorie'
            's"] a[href], p[class="postinfo"] a[href], p[id="filedun'
            'der"] a[href]'
        ),
        'footer[class^="entry-meta"] a[href], footer[class^="entry-footer"] a[href]',
        (
            'li[class="post-category"] a[href], li[class="postcatego'
            'ry"] a[href], li[class="entry-category"] a[href], li[cl'
            'ass*="cat-links" i] a[href], span[class="post-category"'
            '] a[href], span[class="postcategory"] a[href], span[cla'
            'ss="entry-category"] a[href], span[class*="cat-links" i'
            "] a[href]"
        ),
        'header[class="entry-header"] a[href]',
        'div[class="row"] a[href], div[class="tags"] a[href]',
    ]
)

TAG_SELECTORS = tuple(
    [
        'div[class="tags"] a[href]',
        'p[class^="entry-tags"] a[href]',
        (
            'div[class="row"] a[href], div[class="jp-relatedposts"] '
            'a[href], div[class="entry-utility"] a[href], div[class^'
            '="tag" i] a[href], div[class^="postmeta" i] a[href], di'
            'v[class^="meta" i] a[href]'
        ),
        (
            '[class="entry-meta"] a[href], [class*="topics" i] a[hre'
            'f], [class*="tags-links" i] a[href]'
        ),
    ]
)

NAME_FIELDS = dict(
    [
        ["article:author", "author"],
        ["atc-metaauthor", "author"],
        ["author", "author"],
        ["authors", "author"],
        ["byl", "author"],
        ["citation_author", "author"],
        ["creator", "author"],
        ["dc.creator", "author"],
        ["dc.creator.aut", "author"],
        ["dc:creator", "author"],
        ["dcterms.creator", "author"],
        ["dcterms.creator.aut", "author"],
        ["dcsext.author", "author"],
        ["parsely-author", "author"],
        ["rbauthors", "author"],
        ["sailthru.author", "author"],
        ["shareaholic:article_author_name", "author"],
        ["citation_title", "title"],
        ["dc.title", "title"],
        ["dcterms.title", "title"],
        ["fb_title", "title"],
        ["headline", "title"],
        ["parsely-title", "title"],
        ["sailthru.title", "title"],
        ["shareaholic:title", "title"],
        ["rbtitle", "title"],
        ["title", "title"],
        ["twitter:title", "title"],
        ["dc.description", "description"],
        ["dc:description", "description"],
        ["dcterms.abstract", "description"],
        ["dcterms.description", "description"],
        ["description", "description"],
        ["sailthru.description", "description"],
        ["twitter:description", "description"],
        ["article:publisher", "sitename"],
        ["citation_journal_title", "sitename"],
        ["copyright", "sitename"],
        ["dc.publisher", "sitename"],
        ["dc:publisher", "sitename"],
        ["dcterms.publisher", "sitename"],
        ["publisher", "sitename"],
        ["sailthru.publisher", "sitename"],
        ["rbpubname", "sitename"],
        ["twitter:site", "sitename"],
        ["image", "image"],
        ["og:image", "image"],
        ["og:image:url", "image"],
        ["og:image:secure_url", "image"],
        ["twitter:image", "image"],
        ["twitter:image:src", "image"],
        ["citation_keywords", "tags"],
        ["dcterms.subject", "tags"],
        ["keywords", "tags"],
        ["parsely-tags", "tags"],
        ["shareaholic:keywords", "tags"],
        ["tags", "tags"],
    ]
)

PROPERTY_FIELDS = dict(
    [
        ["article:tag", "tags"],
        ["author", "author"],
        ["article:author", "author"],
        ["article:publisher", "sitename"],
        ["image", "image"],
        ["og:image", "image"],
        ["og:image:url", "image"],
        ["og:image:secure_url", "image"],
        ["twitter:image", "image"],
        ["twitter:image:src", "image"],
    ]
)

ITEM_FIELDS = dict([["author", "author"], ["description", "description"], ["headline", "title"]])

BOOTSTRAP_FIELDS = tuple(["title", "author", "url", "description", "sitename", "image"])

OG_FIELDS = dict(
    [
        ["og:title", "title"],
        ["og:description", "description"],
        ["og:site_name", "sitename"],
        ["og:image", "image"],
        ["og:image:url", "image"],
        ["og:image:secure_url", "image"],
        ["og:type", "pagetype"],
    ]
)


def _select_meta_info(document: HtmlElement, selectors: tuple[str, ...], limit: int) -> str | None:
    """Return the first in-range textual candidate in selector priority order."""
    root = content_root(document)
    for selector in selectors:
        for element in query_all(root, selector):
            text = trim(iter_text(element))
            if 2 < len(text) < limit:
                return text
    return None


def examine_title_element(document: HtmlElement) -> tuple[str, str | None, str | None]:
    """Read the title element and its optional site/title split."""
    element = query(document, "head title")
    if element is None:
        element = query(document, "title")
    text = trim(text_content(element))
    match = TITLE_SPLIT.search(text)
    return (text, match[1], match[2]) if match else (text, None, None)


def extract_title(document: HtmlElement) -> str | None:
    """Apply heading, declared title selector and title-element fallback precedence."""
    root = content_root(document)
    headings = [trim(text_content(node)) for node in query_all(root, "h1")]
    if len(headings) == 1 and headings[0]:
        return headings[0]
    selected = _select_meta_info(document, TITLE_SELECTORS, 200)
    if selected:
        return selected
    full, first, second = examine_title_element(document)
    for value in (first, second, full):
        if value and "." not in value:
            return value
    first_heading = next(filter(None, headings), None)
    if first_heading:
        return first_heading
    return trim(text_content(query(root, "h2"))) or full or None


def extract_author(document: HtmlElement) -> str | None:
    """Search a discarded-content-free copy using the source's ordered selectors."""
    source = deepcopy(content_root(document))
    for node in query_all(source, AUTHOR_DISCARD):
        if node.getparent() is not None:
            node.drop_tree()
    for selector in AUTHOR_SELECTORS:
        for node in query_all(source, selector):
            text = trim(iter_text(node))
            if 2 < len(text) < 120:
                return normalize_authors(None, text)
    return None


def extract_cats_tags(kind: str, document: HtmlElement) -> list[str]:
    """Collect the first populated category/tag selector family and deduplicate."""
    root = content_root(document)
    selectors = CATEGORY_SELECTORS if kind == "category" else TAG_SELECTORS
    stem = re.sub("y$", "", kind)
    href = re.compile("/" + stem + r"(?:y|ies|s)?/")
    results = []
    for selector in selectors:
        results.extend(
            text_content(element)
            for element in query_all(root, selector)
            if href.search(element.get("href", ""))
        )
        if results:
            break
    if kind == "category" and not results:
        for element in query_all(
            query(document, "head"),
            'head meta[property="article:section"][content], head meta[name*="subject" i][content]',
        ):
            if element.get("content"):
                results.append(element.get("content"))
    normalized = dict.fromkeys(
        text for value in results if value and (text := line_processing(value))
    )
    return list(normalized)


def normalize_sitename(document: HtmlElement, current: str | None, url: str | None) -> str | None:
    """Normalize the declared publisher or use title/URL fallbacks."""
    source = current
    if source is None:
        _full, first, second = examine_title_element(document)
        source = next((value for value in (first, second) if value and "." in value), None)
    if not source:
        match = re.match(r"https?://(?:www\.|w[0-9]+\.)?([^/]+)", url or "")
        return match[1] if match else None
    name = source.lstrip("@")
    if not name:
        return None
    return title_case(name) if "." not in name and not first_is_upper(name) else name


def _license(element: HtmlElement, strict: bool) -> str | None:
    """Read a recognized CC link or textual license declaration."""
    match = re.search(
        r"/(by-nc-nd|by-nc-sa|by-nc|by-nd|by-sa|by|zero)/([1-9]\.[0-9])", element.get("href", "")
    )
    if match:
        return f"CC {match[1].upper()} {match[2]}"
    text = trim(text_content(element))
    if not text:
        return None
    if not strict:
        return text
    match = re.search(
        r"(cc|creative commons) (by-nc-nd|by-nc-sa|by-nc|by-nd|by-sa|by|zero) ?([1-9]\.[0-9])?",
        text,
        re.IGNORECASE | re.ASCII,
    )
    return match[0] if match else None


def extract_license(document: HtmlElement) -> str | None:
    """Prefer rel=license, then conservative footer declarations."""
    for selector, strict in (
        ('a[rel="license" i][href]', False),
        ('footer a[href], div[class*="footer" i] a[href], div[id*="footer" i] a[href]', True),
    ):
        for element in query_all(content_root(document), selector):
            value = _license(element, strict)
            if value is not None:
                return value
    return None


def _opengraph(document: HtmlElement) -> dict[str, object]:
    """Bootstrap raw OpenGraph fields with last-property-wins precedence."""
    output: dict[str, object] = {}
    for element in query_all(query(document, "head"), 'meta[property^="og:"]'):
        property_name = element.get("property", "")
        content = element.get("content")
        if content is None or not trim(content):
            continue
        destination = OG_FIELDS.get(property_name)
        if destination:
            output[destination] = content
        elif property_name == "og:url":
            if is_valid_url(content):
                output["url"] = content
        elif property_name in {"og:author", "og:article:author"}:
            output["author"] = normalize_authors(None, content)
    return output


def _merge(metadata: dict[str, object], tags: list[str], field: str | None, content: str) -> None:
    """Append authors/tags and otherwise fill only empty fields."""
    if not field:
        return
    if field == "author":
        metadata["author"] = normalize_authors(string_value(metadata.get("author")), content)
    elif field == "tags":
        value = re.sub(r"""["']""", "", trim(html_unescape(content)))
        tags.append(", ".join(filter(None, value.split(", "))))
    elif not metadata.get(field):
        metadata[field] = content


def examine_meta(document: HtmlElement) -> dict[str, object]:
    """Merge OpenGraph and property/name/itemprop metadata in source order."""
    bootstrap = _opengraph(document)
    metadata = {key: bootstrap[key] for key in BOOTSTRAP_FIELDS if bootstrap.get(key)}
    if bootstrap.get("pagetype"):
        metadata["declaredPageType"] = bootstrap["pagetype"]
    tags: list[str] = []
    metadata["tags"] = tags
    if all(metadata.get(key) for key in BOOTSTRAP_FIELDS):
        return metadata
    backup = None
    for element in query_all(query(document, "head"), "meta[content]"):
        content = strip_html_tags(element.get("content", "")).strip()
        if not content:
            continue
        if "property" in element.attrib:
            name = element.get("property", "").lower()
            if not name.startswith("og:"):
                _merge(metadata, tags, PROPERTY_FIELDS.get(name), content)
            continue
        if "name" in element.attrib:
            name = element.get("name", "").lower()
            field = NAME_FIELDS.get(name)
            if field:
                _merge(metadata, tags, field, content)
            elif name == "application-name" or "twitter:app:name" in name:
                backup = content
            elif name == "twitter:url" and not metadata.get("url") and is_valid_url(content):
                metadata["url"] = content
            continue
        item = element.get("itemprop", "").lower()
        _merge(metadata, tags, ITEM_FIELDS.get(item), content)
    if not metadata.get("sitename"):
        metadata["sitename"] = backup
    return metadata
