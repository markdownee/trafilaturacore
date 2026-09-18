# SPDX-License-Identifier: Apache-2.0
"""Offline image source and alt-text handling before the native sanitizer."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from lxml.html import HtmlElement

from ._result import Message
from ._utils import trim


@dataclass
class SrcsetCandidate:
    """One candidate with optional width and density descriptors."""

    url: str
    width: float | None = None
    density: float | None = None
    valid_descriptor: bool = True


def _space(char: str) -> bool:
    """Use HTML's ASCII whitespace when scanning srcset."""
    return bool(char) and char in " \t\n\f\r"


def parse_srcset(value: str) -> list[SrcsetCandidate]:
    """Translate the primary URL-first scan, keeping data-URI commas intact."""
    result = []
    position = 0
    while position < len(value):
        while position < len(value) and (_space(value[position]) or value[position] == ","):
            position += 1
        start = position
        while position < len(value) and not _space(value[position]):
            position += 1
        end = position
        while end > start and value[end - 1] == ",":
            end -= 1
        candidate = SrcsetCandidate(value[start:end])
        descriptors = 0
        if end == position:
            while position < len(value):
                while position < len(value) and _space(value[position]):
                    position += 1
                if position == len(value):
                    break
                if value[position] == ",":
                    position += 1
                    break
                start = position
                while (
                    position < len(value) and not _space(value[position]) and value[position] != ","
                ):
                    position += 1
                descriptors += 1
                descriptor = value[start:position]
                match = re.fullmatch(
                    r"([0-9]+(?:\.[0-9]+)?)([wx])", descriptor, re.IGNORECASE | re.ASCII
                )
                if descriptors > 1 or match is None or descriptor[-1:] not in {"w", "x"}:
                    candidate.valid_descriptor = False
                if match:
                    size = float(match[1])
                    if match[2].lower() == "w":
                        candidate.width = size
                    else:
                        candidate.density = size
        if candidate.url and not candidate.url.lower().startswith("data:"):
            result.append(candidate)
    return result


def _largest(candidates: list[SrcsetCandidate]) -> str | None:
    """Prefer widths, then density, preserving the first equal-ranked candidate."""
    use_width = any(candidate.width is not None for candidate in candidates)
    best = None
    rank = float("-inf")
    for candidate in candidates:
        if use_width and candidate.width is None:
            continue
        value = candidate.width if use_width else candidate.density
        value = (0 if use_width else 1) if value is None else value
        if best is None or value > rank:
            best, rank = candidate, value
    return best.url if best is not None else None


def _usable(value: str | None) -> str | None:
    """Ignore missing, blank and data-URI source candidates."""
    normalized = value.strip() if value is not None else ""
    return normalized if normalized and not normalized.lower().startswith("data:") else None


def _source(image: HtmlElement) -> str | None:
    """Preserve lazy/canonical source precedence before considering srcset."""
    for name in ("data-src", "src"):
        candidate = _usable(image.get(name))
        if candidate is not None:
            return candidate
    for name, value in image.attrib.items():
        if name.startswith("data-src") and name not in {"data-src", "data-srcset"}:
            candidate = _usable(value)
            if candidate is not None:
                return candidate
    own = image.get("srcset")
    if own is None:
        own = image.get("data-srcset")
    candidates = parse_srcset(own) if own is not None else []
    if not candidates:
        picture = next(image.iterancestors("picture"), None)
        if picture is not None:
            for source in picture.iter("source"):
                raw = source.get("srcset")
                if raw is None:
                    raw = source.get("data-srcset")
                if raw is not None:
                    candidates.extend(parse_srcset(raw))
    return _largest(candidates)


def _alt(
    image: HtmlElement, figures: dict[HtmlElement, list[HtmlElement]], ids: dict[str, HtmlElement]
) -> tuple[str | None, bool]:
    """Apply explicit alt, caption, ARIA and title fallbacks in primary order."""
    explicit = image.get("alt")
    if explicit is not None:
        value = trim(explicit)
        return value or None, not value
    figure = next(image.iterancestors("figure"), None)
    if figure is not None and len(figures.get(figure, [])) == 1:
        # Native captions historically joined all caption text segments.
        caption = trim(
            " ".join(text for node in figure.iter("figcaption") for text in node.itertext())
        )
        if caption:
            return caption, False
    label = trim(image.get("aria-label", ""))
    if label:
        return label, False
    descriptions = [
        trim("".join(ids[key].itertext()))
        for key in image.get("aria-labelledby", "").split()
        if key in ids
    ]
    labelled = " ".join(filter(None, descriptions))
    if labelled:
        return labelled, False
    return trim(image.get("title", "")) or None, False


def apply_images(
    document: HtmlElement, mode: str, base: str | None, messages: list[Message]
) -> None:
    """Transform images in place while retaining native fragment/URL semantics."""
    if mode not in {"alt-text", "resolved-url"}:
        return
    ids = {node.get("id"): node for node in document.iter() if node.get("id") is not None}
    figures = {figure: list(figure.iter("img")) for figure in document.iter("figure")}
    unresolved = invalid = False
    for image in list(document.iter("img")):
        if mode == "alt-text":
            alt, decorative = _alt(image, figures, ids)
            if decorative:
                if image.getparent() is not None:
                    image.drop_tree()
                continue
            image.attrib.clear()
            if alt:
                image.set("alt", alt)
            continue
        candidate = _source(image)
        for name in list(image.attrib):
            if name not in {"src", "alt", "title", "width", "height"}:
                del image.attrib[name]
        if candidate is None:
            continue
        try:
            resolved = urljoin(base or "", candidate)
            parsed = urlsplit(resolved)
        except ValueError:
            image.attrib.pop("src", None)
            invalid = True
        else:
            image.set("src", resolved)
            unresolved |= not base and not bool(parsed.scheme)
    for tag in ("source", "picture"):
        for element in list(document.iter(tag)):
            if element.getparent() is not None:
                element.drop_tag()
    for figure, previous in figures.items():
        if previous and next(figure.iter("img"), None) is None and figure.getparent() is not None:
            figure.drop_tree()
    if unresolved:
        messages.append(Message("warning", "relative image URL left unchanged without a base URL"))
    if invalid:
        messages.append(Message("warning", "invalid image URL removed"))
