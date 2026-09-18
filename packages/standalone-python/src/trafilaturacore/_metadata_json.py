# SPDX-License-Identifier: Apache-2.0
# JSON metadata handling derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/json_metadata.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/json_metadata.py
#   trafilatura/metadata.py::extract_meta_json
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/metadata.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted JSON traversal, regex matching and bounded fallback parsing.
"""JSON-LD metadata merging and bounded malformed-data fallback."""

from __future__ import annotations

import json
import re

from lxml.html import HtmlElement

from ._errors import ResourceLimitError
from ._metadata_authors import normalize_authors
from ._metadata_dom import query_all, text_content
from ._metadata_text import normalize_json, string_value
from ._settings import MAX_JSON_AUTHOR_FALLBACK_UNITS, MAX_JSON_AUTHOR_RESCAN_UNITS

AUTHOR_ATTRS = tuple(["givenName", "additionalName", "familyName"])
JSON_ARTICLE_SCHEMA = frozenset(
    [
        "article",
        "backgroundnewsarticle",
        "blogposting",
        "medicalscholarlyarticle",
        "newsarticle",
        "opinionnewsarticle",
        "reportagenewsarticle",
        "scholarlyarticle",
        "socialmediaposting",
        "liveblogposting",
    ]
)
JSON_AUTHOR_1 = re.compile(
    '"author":[^}[]+?"name?\\\\?": ?\\\\?"([^"\\\\]+)|"author"[^}[]+?"names?"[\\s\\S]+?"([^"]+)'
)
JSON_AUTHOR_2 = re.compile('"[Pp]erson"[^}]+?"names?"[\\s\\S]+?"([^"]+)')
JSON_AUTHOR_REMOVE = re.compile(
    ',?(?:"\\w+":?[:|,[])?\\{?"@type":"(?:[Ii]mageObject|[Oo]rganization|[Ww]eb[Pp]age)",[^}[]+\\}[\\]|}]?',
    re.ASCII,
)
JSON_CATEGORY = re.compile('"articleSection": ?"([^"\\\\]+)')
JSON_HEADLINE = re.compile('"headline": ?"([^"\\\\]+)')
JSON_MINIFY = re.compile(
    '("(?:\\\\.|[^"\\\\])*")|[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
)
JSON_NAME = re.compile('"@type":"[Aa]rticle", ?"name": ?"([^"\\\\]+)')
JSON_OGTYPE_SCHEMA = frozenset(
    [
        "aboutpage",
        "checkoutpage",
        "collectionpage",
        "contactpage",
        "faqpage",
        "itempage",
        "medicalwebpage",
        "profilepage",
        "qapage",
        "realestatelisting",
        "searchresultspage",
        "webpage",
        "website",
        "article",
        "advertisercontentarticle",
        "newsarticle",
        "analysisnewsarticle",
        "askpublicnewsarticle",
        "backgroundnewsarticle",
        "opinionnewsarticle",
        "reportagenewsarticle",
        "reviewnewsarticle",
        "report",
        "satiricalarticle",
        "scholarlyarticle",
        "medicalscholarlyarticle",
        "socialmediaposting",
        "blogposting",
        "liveblogposting",
        "discussionforumposting",
        "techarticle",
        "blog",
        "jobposting",
    ]
)
JSON_PUBLISHER = re.compile('"publisher":[^}]+?"name?\\\\?": ?\\\\?"([^"\\\\]+)')
JSON_PUBLISHER_SCHEMA = frozenset(["newsmediaorganization", "organization", "webpage", "website"])
JSON_SCHEMA_ORG = re.compile("^https?:\\/\\/schema\\.org", re.IGNORECASE | re.ASCII)
JSON_TYPE = re.compile(
    '"@type"[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]*:[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]*"([^"]*)"'
)


def _object(value: object) -> bool:
    """Distinguish JSON objects from lists and scalars."""
    return isinstance(value, dict)


def _array(value: object) -> list[object]:
    """Apply the source's singleton-list normalization."""
    return value if isinstance(value, list) else [value]


def _prefer_publisher(
    current: str | None, candidate: object, content_type: str | None = None
) -> bool:
    """Apply the source's publisher replacement policy."""
    if not isinstance(candidate, str) or not candidate:
        return False
    return (
        not current
        or (content_type != "webpage" and len(candidate) > len(current))
        or (current.startswith("http") and not candidate.startswith("http"))
    )


def _person_name(value: object) -> str | None:
    """Interpret supported author/name shapes without coercing arbitrary JSON."""
    if isinstance(value, str):
        return value
    if not isinstance(value, dict) or "@type" in value and value["@type"] != "Person":
        return None
    if "name" in value:
        name = value["name"]
        if isinstance(name, str):
            return name
        if isinstance(name, list):
            return "; ".join(entry for entry in name if isinstance(entry, str)).strip("; ")
        if isinstance(name, dict) and isinstance(name.get("name"), str):
            return name["name"]
        return None
    if "givenName" in value and "familyName" in value:
        return " ".join(value[field] for field in AUTHOR_ATTRS if isinstance(value.get(field), str))
    return None


def _strict_constant(value: str) -> None:
    """Reject nonstandard constants on the source's strict JSON.parse author path."""
    raise ValueError(f"invalid JSON constant: {value}")


class MetadataJson:
    """Field-specific merge behavior from the primary JSON metadata implementation."""

    def __init__(self, metadata: dict[str, object]) -> None:
        """Bind the mutable metadata sidecar under construction."""
        self.metadata = metadata

    def _author(self, value: object) -> None:
        """Append supported person names while retaining string fallback behavior."""
        authors = value
        if isinstance(value, str):
            try:
                authors = json.loads(value, parse_constant=_strict_constant)
            except RecursionError as error:
                raise ResourceLimitError("JSON nesting exceeds the native parser limit") from error
            except ValueError:
                self.metadata["author"] = normalize_authors(
                    string_value(self.metadata.get("author")), value
                )
        for author in _array(authors):
            name = _person_name(author)
            if name is not None:
                self.metadata["author"] = normalize_authors(
                    string_value(self.metadata.get("author")), name
                )

    def _content(self, value: object) -> None:
        """Process one guarded schema object."""
        if not isinstance(value, dict):
            return
        metadata = self.metadata
        publisher = value.get("publisher")
        if isinstance(publisher, dict) and _prefer_publisher(
            string_value(metadata.get("sitename")), publisher.get("name")
        ):
            metadata["sitename"] = publisher["name"]
        raw_type = value.get("@type")
        first_type = (
            raw_type[0]
            if isinstance(raw_type, list) and raw_type
            else None
            if isinstance(raw_type, list)
            else raw_type
        )
        if not isinstance(first_type, str) or not first_type:
            return
        content_type = first_type.lower()
        if not metadata.get("declaredPageType") and content_type in JSON_OGTYPE_SCHEMA:
            metadata["declaredPageType"] = normalize_json(content_type)
        if content_type in JSON_PUBLISHER_SCHEMA:
            # Native metadata retains truthy publisher fallback; the primary
            # TypeScript adapter's nullish policy would lose legalName on name="".
            publisher = value.get("name") or value.get("legalName") or value.get("alternateName")
            if _prefer_publisher(string_value(metadata.get("sitename")), publisher, content_type):
                metadata["sitename"] = publisher
            return
        if content_type == "person":
            name = value.get("name")
            if isinstance(name, str) and name and not name.startswith("http"):
                metadata["author"] = normalize_authors(string_value(metadata.get("author")), name)
            return
        if content_type not in JSON_ARTICLE_SCHEMA:
            return
        if "author" in value:
            self._author(value["author"])
        if metadata.get("categories") is None and "articleSection" in value:
            section = value["articleSection"]
            if isinstance(section, str):
                metadata["categories"] = [section]
            elif isinstance(section, list):
                metadata["categories"] = [
                    entry for entry in section if isinstance(entry, str) and entry
                ]
        if not metadata.get("title"):
            if content_type == "article" and isinstance(value.get("name"), str):
                metadata["title"] = value["name"]
            elif isinstance(value.get("headline"), str):
                metadata["title"] = value["headline"]

    def parsed(self, schema: object) -> None:
        """Flatten only the approved context/graph/live-blog containers."""
        for container in _array(schema):
            if not isinstance(container, dict):
                continue
            context = container.get("@context")
            if not isinstance(context, str) or not JSON_SCHEMA_ORG.search(context):
                continue
            content: object = container
            if "@graph" in container:
                content = container["@graph"]
            elif (
                isinstance(container.get("@type"), str)
                and "liveblogposting" in container["@type"].lower()
                and "liveBlogUpdate" in container
            ):
                content = container["liveBlogUpdate"]
            for entry in _array(content):
                self._content(entry)

    def malformed(self, source: str) -> None:
        """Use the primary regex fallback and field replacement precedence."""
        metadata = self.metadata
        author_text = JSON_AUTHOR_REMOVE.sub("", source)
        author = _fallback_authors(author_text, JSON_AUTHOR_1)
        if author is None:
            author = _fallback_authors(author_text, JSON_AUTHOR_2)
        if author:
            metadata["author"] = author
        match = JSON_TYPE.search(source)
        if match and match[1]:
            candidate = normalize_json(match[1].lower())
            if candidate in JSON_OGTYPE_SCHEMA:
                metadata["declaredPageType"] = candidate
        match = JSON_PUBLISHER.search(source)
        if match and match[1] and "," not in match[1]:
            candidate = normalize_json(match[1])
            if _prefer_publisher(string_value(metadata.get("sitename")), candidate):
                metadata["sitename"] = candidate
        match = JSON_CATEGORY.search(source)
        if match and match[1]:
            metadata["categories"] = [normalize_json(match[1])]
        if not metadata.get("title"):
            name = JSON_NAME.search(source)
            headline = JSON_HEADLINE.search(source)
            candidate = name[1] if name and name[1] else headline[1] if headline else None
            if candidate:
                metadata["title"] = normalize_json(candidate)


def _fallback_authors(source: str, pattern: re.Pattern[str]) -> str | None:
    """Truncate by UTF-16 units, then charge every remove-and-rescan iteration."""
    remaining = (
        source[:MAX_JSON_AUTHOR_FALLBACK_UNITS]
        .encode("utf-16-le", errors="surrogatepass")[: MAX_JSON_AUTHOR_FALLBACK_UNITS * 2]
        .decode("utf-16-le", errors="surrogatepass")
    )
    work = 0
    result = None
    while match := pattern.search(remaining):
        name = next((group for group in match.groups() if group), None)
        if not name or " " not in name:
            break
        result = normalize_authors(result, name)
        work += len(remaining.encode("utf-16-le", errors="surrogatepass")) // 2
        if work > MAX_JSON_AUTHOR_RESCAN_UNITS:
            break
        remaining = remaining[: match.start()] + remaining[match.end() :]
    return result


def extract_json_ld(document: HtmlElement, metadata: dict[str, object]) -> None:
    """Parse normalized script text and merge its supported fields."""
    reader = MetadataJson(metadata)
    for script in query_all(document, "script[type]"):
        if script.get("type") not in {"application/ld+json", "application/settings+json"}:
            continue
        raw = text_content(script)
        if not raw:
            continue
        minified = JSON_MINIFY.sub(lambda match: match[1] or "", raw)
        normalized = normalize_json(minified)
        try:
            parsed = json.loads(normalized, strict=False, parse_constant=lambda _value: None)
            reader.parsed(parsed)
        except RecursionError as error:
            raise ResourceLimitError("JSON nesting exceeds the native parser limit") from error
        except ValueError:
            reader.malformed(normalized)
