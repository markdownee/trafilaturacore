# SPDX-License-Identifier: Apache-2.0
# Config vocabulary derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/settings.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/settings.py
#   trafilatura/htmlprocessing.py
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/htmlprocessing.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: adapted fragment defaults, nh3 sanitization, wildcard/config handling,
# restricted CSS, content filtering and diagnostics.
"""Content policy and unconditional native sanitization of supplied HTML."""

from __future__ import annotations

import fnmatch
import re
from html import escape
from urllib.parse import unquote, urlsplit

import nh3
from lxml import etree
from lxml.html import HtmlElement, tostring

from ._errors import ResourceLimitError
from ._images import apply_images, parse_srcset
from ._limits import MAX_OUTPUT_BYTES, bound_output
from ._options import CleanConfig
from ._result import Message

DEFAULT_TAGS = frozenset(
    [
        "p",
        "blockquote",
        "pre",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "li",
        "table",
        "tr",
        "td",
        "th",
        "a",
        "img",
        "i",
        "strong",
        "u",
        "var",
        "sub",
        "sup",
        "del",
        "br",
        "title",
        "hr",
        "ol",
        "dl",
        "dt",
        "dd",
        "caption",
        "colgroup",
        "col",
        "figure",
        "figcaption",
        "picture",
        "source",
        "em",
        "b",
        "s",
        "q",
        "code",
        "kbd",
        "samp",
    ]
)
DEFAULT_ATTRIBUTES = {
    "a": ["href", "title"],
    "img": ["src", "alt", "title", "width", "height"],
    "source": ["src", "srcset", "type", "media"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan", "scope"],
    "blockquote": ["cite"],
    "q": ["cite"],
    "col": ["span"],
    "colgroup": ["span"],
    "ol": ["start", "type", "reversed"],
    "code": ["class"],
}
DEFAULT_TRANSFORMS = {
    "strike": "del",
    "tt": "var",
    "dir": "ul",
    "listing": "pre",
    "xmp": "pre",
    "plaintext": "pre",
}
DEFAULT_DISCARD = frozenset(
    [
        "aside",
        "embed",
        "fencedframe",
        "form",
        "iframe",
        "menu",
        "object",
        "script",
        "applet",
        "audio",
        "canvas",
        "map",
        "svg",
        "video",
        "area",
        "blink",
        "button",
        "datalist",
        "dialog",
        "frame",
        "frameset",
        "fieldset",
        "link",
        "input",
        "ins",
        "label",
        "legend",
        "marquee",
        "math",
        "menuitem",
        "nav",
        "noindex",
        "noscript",
        "optgroup",
        "option",
        "output",
        "param",
        "progress",
        "rp",
        "rt",
        "rtc",
        "select",
        "style",
        "track",
        "textarea",
        "time",
        "use",
    ]
)
IMAGE_TAGS = frozenset(["img", "figure", "figcaption", "picture", "source"])
TABLE_TAGS = frozenset(["table", "caption", "tr", "td", "th", "colgroup", "col"])

FORBIDDEN = frozenset(
    ("script", "style", "link", "iframe", "object", "embed", "applet", "base", "svg", "math")
)
URL_ATTRIBUTES = frozenset(
    (
        "href",
        "src",
        "cite",
        "action",
        "formaction",
        "poster",
        "background",
        "xlink:href",
        "longdesc",
        "usemap",
    )
)
URL_SCHEMES = frozenset(("http", "https", "mailto", "tel", "ftp"))
STYLE_PROPERTIES = frozenset(
    (
        "color",
        "background-color",
        "font-size",
        "font-weight",
        "font-style",
        "font-family",
        "text-align",
        "text-decoration",
        "white-space",
        "border",
        "border-color",
        "border-width",
        "border-style",
        "margin",
        "padding",
        "width",
        "height",
        "max-width",
        "max-height",
    )
)
COMMENT_TOKEN = re.compile(
    r"(?:^|[\s_-])(?:comment(?:s|area|container|list|listing|thread)?|discussion|disqus)(?:$|[\s_-])",
    re.IGNORECASE,
)


def _fragment(tree: HtmlElement) -> str:
    """Serialize a compact fragment while checking each appended child's byte cost."""
    body = tree.find("body")
    root = tree if body is None else body
    pieces = [escape(root.text or "", quote=False)]
    used = len(pieces[0].encode("utf-8"))
    for child in root:
        piece = tostring(child, encoding="unicode", method="html")
        used += len(piece.encode("utf-8"))
        if used > MAX_OUTPUT_BYTES:
            raise ResourceLimitError("output exceeds the UTF-8 byte limit")
        pieces.append(piece)
    return bound_output("".join(pieces))


def exclude_comments(tree: HtmlElement) -> None:
    """Remove identified user-comment containers while retaining surrounding text."""
    for element in list(tree.iter()):
        if element.getparent() is None or not isinstance(element.tag, str):
            continue
        if any(
            COMMENT_TOKEN.search(element.get(name, ""))
            for name in ("id", "class", "itemprop", "data-testid", "aria-label")
        ):
            element.drop_tree()


def _attribute_filter(_tag: str, name: str, value: str) -> str | None:
    """Apply the native security floor after configurable attribute admission."""
    if name.startswith("on") or name in {"srcdoc", "http-equiv", "xmlns", "ping"}:
        return None
    if name in URL_ATTRIBUTES:
        compact = re.sub(r"[\x00-\x20\x7f]", "", unquote(value))
        try:
            scheme = urlsplit(compact).scheme.lower()
        except ValueError:
            return None
        if scheme and scheme not in URL_SCHEMES:
            return None
    if name == "srcset":
        retained = []
        for candidate in parse_srcset(value):
            if (
                not candidate.valid_descriptor
                or _attribute_filter(_tag, "src", candidate.url) is None
            ):
                continue
            width = candidate.width is not None
            rank = candidate.width if width else candidate.density
            rank = 1 if rank is None else rank
            retained.append(f"{candidate.url} {rank:g}{'w' if width else 'x'}")
        return ", ".join(retained) or None
    if name == "style" and (
        "\\" in value
        or "/*" in value
        or re.search(r"url\s*\(|expression\s*\(|@", value, re.IGNORECASE)
    ):
        return None
    return value


def _classes(
    element: HtmlElement,
    target: str,
    patterns: dict[str, list[str]],
    attributes: dict[str, set[str]],
) -> None:
    """Materialize native wildcard class admission without mutating caller data."""
    if "class" not in element.attrib:
        return
    allowed = patterns.get(target, []) + patterns.get("*", [])
    kept = [
        token
        for token in element.get("class", "").split()
        if any(fnmatch.fnmatchcase(token, pattern) for pattern in allowed)
    ]
    if kept:
        element.set("class", " ".join(kept))
        attributes.setdefault(target, set()).add("class")
    else:
        del element.attrib["class"]


def clean_tree(
    tree: HtmlElement,
    *,
    config: CleanConfig | None,
    image_handling: str,
    link_handling: str,
    table_handling: str,
    comment_handling: str,
    base: str | None,
    messages: list[Message],
) -> str:
    """Derive effective policy, transform content, then always run the native sanitizer."""
    policy = {} if config is None else config
    tags = set(policy.get("allowedTags", DEFAULT_TAGS)) - FORBIDDEN
    attributes = {
        tag: set(names)
        for tag, names in policy.get("allowedAttributes", DEFAULT_ATTRIBUTES).items()
    }
    discard = set(policy.get("nonTextTags", DEFAULT_DISCARD)) | FORBIDDEN
    transforms = policy.get("transformTags", DEFAULT_TRANSFORMS)
    if image_handling == "exclude":
        tags.difference_update(IMAGE_TAGS)
        discard.update(IMAGE_TAGS - {"figcaption"})
    if table_handling == "exclude":
        tags.difference_update(TABLE_TAGS)
        discard.add("table")
    if link_handling == "exclude":
        tags.discard("a")
    if comment_handling == "exclude":
        exclude_comments(tree)
    apply_images(tree, image_handling, base, messages)
    classes = policy.get("allowedClasses")
    for element in list(tree.iter()):
        if element.getparent() is None or not isinstance(element.tag, str):
            continue
        original = element.tag
        target = transforms.get(original, original)
        refresh = target == "meta" and (
            element.get("http-equiv") is not None
            or re.match(r"\s*\d+\s*;\s*url\s*=", element.get("content", ""), re.IGNORECASE)
        )
        if refresh or original in FORBIDDEN or original in discard or target in discard:
            element.drop_tree()
            continue
        element.tag = target
        if classes is not None:
            _classes(element, target, classes, attributes)
        patterns = attributes.get(target, set()) | attributes.get("*", set())
        matched = {
            name
            for name in element.attrib
            if any(fnmatch.fnmatchcase(name, pattern) for pattern in patterns)
        }
        attributes.setdefault(target, set()).update(matched)
    tags.difference_update(discard)
    attributes = {tag: names for tag, names in attributes.items() if tag not in discard}
    try:
        result = nh3.clean(
            _fragment(tree),
            tags=tags,
            clean_content_tags=discard,
            attributes=attributes,
            attribute_filter=_attribute_filter,
            url_schemes=set(URL_SCHEMES),
            link_rel=None,
            filter_style_properties=set(STYLE_PROPERTIES),
        )
    except ResourceLimitError:
        raise
    except (ValueError, etree.Error) as error:
        raise ValueError("invalid cleaning configuration") from error
    return bound_output(result)
