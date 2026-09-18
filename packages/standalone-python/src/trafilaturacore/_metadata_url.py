# SPDX-License-Identifier: Apache-2.0
# URL selection derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/metadata.py::extract_url and URL_SELECTORS
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted URL selection; separately installed Courlan 1.4.0 supplies
# URL/domain cleanup, including tracking-parameter and suffix handling.
"""Canonical URL selection with the native Python URL dependency boundary."""

from __future__ import annotations

from courlan import extract_domain as domain_for
from courlan import get_base_url, normalize_url, validate_url
from courlan import is_valid_url as valid_url
from lxml.html import HtmlElement

from ._metadata_dom import query, query_all


def is_valid_url(value: str) -> bool:
    """Keep the native library's existing metadata URL validation semantics."""
    return bool(valid_url(value))


def extract_domain(value: str) -> str | None:
    """Keep the native fast registrable-domain behavior, including multi-label suffixes."""
    return domain_for(value, fast=True)


def extract_url(document: HtmlElement, default_url: str | None = None) -> str | None:
    """Probe canonical/base/default-language links, then apply the native URL adapter."""
    links = query_all(document, "head link[rel]")
    canonical = next((link for link in links if link.get("rel") == "canonical"), None)
    alternate = next(
        (
            link
            for link in links
            if link.get("rel") == "alternate" and link.get("hreflang") == "x-default"
        ),
        None,
    )
    candidate = None
    for element in (canonical, query(document, "head base"), alternate):
        if element is not None and element.get("href"):
            candidate = element.get("href")
            break
    if candidate and candidate.startswith("/"):
        for element in query_all(query(document, "head"), "meta[content]"):
            name = element.get("name") or element.get("property") or ""
            if not name.startswith(("og:", "twitter:")):
                continue
            base = get_base_url(element.get("content", ""))
            if base:
                candidate = base + candidate
                break
    if candidate:
        valid, parsed = validate_url(candidate)
        if valid and parsed:
            return normalize_url(parsed)
    return default_url
