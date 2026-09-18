# SPDX-License-Identifier: Apache-2.0
# Metadata stage/cleanup ancestry from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/metadata.py::extract_metadata
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
#   trafilatura/settings.py::Document.clean_and_trim
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/settings.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted stage ordering, htmldate integration, image cleanup, OpenGraph
# handling, result trimming and fallback-host behavior.
"""Offline metadata assembly with explicitly retained native Python adapters."""

from __future__ import annotations

from datetime import date
from typing import cast
from urllib.parse import urlsplit

from htmldate import find_date
from lxml.html import HtmlElement

from ._errors import ResourceLimitError
from ._metadata_dom import ascii_lower, query_all
from ._metadata_fields import (
    examine_meta,
    extract_author,
    extract_cats_tags,
    extract_license,
    extract_title,
    normalize_sitename,
)
from ._metadata_json import extract_json_ld
from ._metadata_text import line_processing, string_value
from ._metadata_url import extract_domain, extract_url
from ._result import Metadata
from ._utils import html_unescape

_STRING_FIELDS = (
    "title",
    "author",
    "url",
    "hostname",
    "description",
    "sitename",
    "date",
    "declaredPageType",
    "license",
    "image",
)


def metadata_for(tree: HtmlElement, url: str | None) -> Metadata | None:
    """Read supplied markup only, retaining the existing Python capability surface."""
    values = examine_meta(tree)
    author = string_value(values.get("author"))
    if author and " " not in author:
        values["author"] = None
    try:
        extract_json_ld(tree, values)
    except ResourceLimitError:
        raise
    except (ValueError, TypeError, OverflowError, RecursionError):
        # The primary orchestrator keeps malformed JSON metadata non-fatal.
        pass
    if not values.get("title"):
        values["title"] = extract_title(tree)
    if not values.get("author"):
        values["author"] = extract_author(tree)
    if not values.get("url"):
        values["url"] = extract_url(tree, url)
    selected_url = string_value(values.get("url"))
    if selected_url:
        values["hostname"] = extract_domain(selected_url)
    # The old Python library supports date formats/priorities beyond date.ts's
    # reduced heuristic. This native adapter preserves that functionality.
    values["date"] = find_date(
        tree,
        original_date=True,
        extensive_search=False,
        max_date=date.today().isoformat(),
        url=selected_url,
    )
    values["sitename"] = normalize_sitename(
        tree, string_value(values.get("sitename")), selected_url
    )
    if not values.get("categories"):
        values["categories"] = extract_cats_tags("category", tree)
    if not values.get("tags"):
        values["tags"] = extract_cats_tags("tag", tree)
    values["license"] = extract_license(tree)
    for field in _STRING_FIELDS:
        value = values.get(field)
        if isinstance(value, str):
            bounded = value[:9999] + "…" if len(value) > 10000 else value
            values[field] = line_processing(html_unescape(bounded))
    result: dict[str, str | list[str]] = {}
    for field, value in values.items():
        if isinstance(value, str) and value.strip():
            result[field] = value.strip()
        elif isinstance(value, list) and value:
            result[field] = [item for item in value if isinstance(item, str) and item]
    # Preserve the native wrapper's first document-wide raw declaration. An
    # empty first matching content value does not authorize a later override.
    declared = next(
        (
            element.get("content", "")
            for element in query_all(tree, "meta[property][content]")
            if ascii_lower(element.get("property", "")) == "og:type"
        ),
        None,
    )
    if declared is not None and declared.strip():
        result["declaredPageType"] = declared.strip()
    if url and "url" not in result:
        result["url"] = url
        hostname = urlsplit(url).hostname
        if hostname:
            result["hostname"] = hostname
    return cast(Metadata, result) if result else None
