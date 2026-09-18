# SPDX-License-Identifier: Apache-2.0
"""Native supplied-HTML pipeline without upstream extraction delegation."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from urllib.parse import urlsplit

from ._cleaning import clean_tree, exclude_comments
from ._core import extract_document
from ._dom import parse_html
from ._errors import ResourceLimitError
from ._extract_options import Options
from ._limits import MAX_OUTPUT_BYTES, bound_output, preflight
from ._metadata import metadata_for
from ._options import (
    BOILERPLATE_MODES,
    COMMENT_HANDLING_MODES,
    DEFAULT_MAX_INPUT_BYTES,
    IMAGE_HANDLING_MODES,
    LINK_HANDLING_MODES,
    TABLE_HANDLING_MODES,
    BoilerplateMode,
    CleanConfig,
    CommentHandlingMode,
    ImageHandlingMode,
    LinkHandlingMode,
    TableHandlingMode,
    validate_config,
    validate_mode,
)
from ._result import CleanResult, Message


def _url_context(url: str | None) -> None:
    """Validate context without performing network work."""
    if url is None:
        return
    if not isinstance(url, str):
        raise TypeError("url must be a string")
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("url must be an absolute HTTP or HTTPS URL")


def clean(
    html: str | bytes,
    *,
    boilerplate: BoilerplateMode = "balanced",
    image_handling: ImageHandlingMode = "include",
    link_handling: LinkHandlingMode = "include",
    table_handling: TableHandlingMode = "include",
    comment_handling: CommentHandlingMode = "include",
    url: str | None = None,
    config: CleanConfig | None = None,
    max_input_bytes: int = DEFAULT_MAX_INPUT_BYTES,
) -> CleanResult:
    """Extract and sanitize supplied HTML entirely within the native Python process."""
    validate_config(config)
    choices = (
        ("boilerplate", boilerplate, BOILERPLATE_MODES),
        ("image_handling", image_handling, IMAGE_HANDLING_MODES),
        ("link_handling", link_handling, LINK_HANDLING_MODES),
        ("table_handling", table_handling, TABLE_HANDLING_MODES),
        ("comment_handling", comment_handling, COMMENT_HANDLING_MODES),
    )
    for field, value, allowed in choices:
        validate_mode(value, allowed, field)
    _url_context(url)
    source = preflight(html, max_input_bytes)
    if not source.strip():
        return CleanResult(html="", messages=[])
    document = parse_html(source)
    messages: list[Message] = []
    try:
        metadata = metadata_for(deepcopy(document), url)
    except ResourceLimitError:
        raise
    except MemoryError as error:
        raise ResourceLimitError("metadata memory limit reached") from error
    except Exception:
        metadata = None
        messages.append(Message("warning", "metadata extraction failed"))
    base = url
    if base is None:
        raw = next(
            (
                element.get("href")
                for element in document.iter("base")
                if element.get("href") is not None
            ),
            None,
        )
        if raw is not None:
            candidate = raw.strip()
            try:
                if urlsplit(candidate).scheme in {"http", "https"}:
                    base = candidate
            except ValueError:
                pass
    if boilerplate != "keep":
        extraction_document = document
        if comment_handling == "exclude":
            extraction_document = deepcopy(document)
            exclude_comments(extraction_document)
        try:
            # Native URL context historically affects metadata and the resolved-url
            # image pass, not ordinary extraction's link/src spelling.
            extracted = extract_document(
                extraction_document,
                Options(focus=boilerplate, include_comments=comment_handling != "exclude"),
            )
            fragment = extracted.content_html + (
                extracted.comments_html if comment_handling != "exclude" else ""
            )
            if fragment:
                # Bound and preflight the generated fragment before its cleaning DOM.
                document = parse_html(
                    preflight(bound_output(fragment), max_input_bytes=MAX_OUTPUT_BYTES)
                )
            else:
                messages.append(
                    Message(
                        "warning",
                        "boilerplate removal produced no content; cleaning the whole document",
                    )
                )
        except ResourceLimitError:
            raise
        except MemoryError as error:
            raise ResourceLimitError("extraction memory limit reached") from error
        except Exception:
            messages.append(
                Message("warning", "boilerplate removal failed; cleaning the whole document")
            )
    secured = clean_tree(
        document,
        config=config,
        image_handling=image_handling,
        link_handling=link_handling,
        table_handling=table_handling,
        comment_handling=comment_handling,
        base=base,
        messages=messages,
    )
    return CleanResult(
        html=secured,
        messages=messages,
        metadata=metadata,
        declared_page_type=metadata.get("declaredPageType") if metadata else None,
    )


async def aclean(
    html: str | bytes,
    *,
    boilerplate: BoilerplateMode = "balanced",
    image_handling: ImageHandlingMode = "include",
    link_handling: LinkHandlingMode = "include",
    table_handling: TableHandlingMode = "include",
    comment_handling: CommentHandlingMode = "include",
    url: str | None = None,
    config: CleanConfig | None = None,
    max_input_bytes: int = DEFAULT_MAX_INPUT_BYTES,
) -> CleanResult:
    """Run bounded cleaning in a thread; cancellation cannot stop an active worker."""
    return await asyncio.to_thread(
        clean,
        html,
        boilerplate=boilerplate,
        image_handling=image_handling,
        link_handling=link_handling,
        table_handling=table_handling,
        comment_handling=comment_handling,
        url=url,
        config=deepcopy(config),
        max_input_bytes=max_input_bytes,
    )
