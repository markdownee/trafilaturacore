# SPDX-License-Identifier: Apache-2.0
"""Validated native options, independent of either product CLI."""

from __future__ import annotations

import re
from typing import Literal, TypedDict, get_args

BoilerplateMode = Literal["precision", "balanced", "recall", "keep"]
ImageHandlingMode = Literal["include", "exclude", "alt-text", "resolved-url"]
LinkHandlingMode = Literal["include", "exclude"]
TableHandlingMode = Literal["include", "exclude"]
CommentHandlingMode = Literal["include", "exclude"]
BOILERPLATE_MODES = get_args(BoilerplateMode)
IMAGE_HANDLING_MODES = get_args(ImageHandlingMode)
LINK_HANDLING_MODES = get_args(LinkHandlingMode)
TABLE_HANDLING_MODES = get_args(TableHandlingMode)
COMMENT_HANDLING_MODES = get_args(CommentHandlingMode)
DEFAULT_BOILERPLATE_MODE = "balanced"
DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024
VOID_TAGS = frozenset(
    [
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    ]
)


class CleanConfig(TypedDict, total=False):
    """JSON cleaning vocabulary shared with TypeScript; serialization follows HTML."""

    allowedTags: list[str]
    allowedAttributes: dict[str, list[str]]
    allowedClasses: dict[str, list[str]]
    selfClosing: list[str]
    nonTextTags: list[str]
    transformTags: dict[str, str]


def validate_mode(value: object, vocabulary: tuple[str, ...], field: str) -> None:
    """Apply the shared mode guard with the native API's error contract."""
    if isinstance(value, str) and any(value == member for member in vocabulary):
        return
    raise ValueError(f"{field} must be one of: {', '.join(vocabulary)}")


def _string_list(value: object) -> bool:
    """Check a JSON string array without coercion."""
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _tag_name(value: object) -> bool:
    """Retain the native lowercase HTML-name vocabulary."""
    return isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9-]*", value) is not None


def validate_config(value: object) -> None:
    """Translate the primary schema guard and preserve native HTML serialization limits."""
    if value is None:
        return
    if not isinstance(value, dict):
        raise TypeError("config must be a dictionary")
    array_fields = {"allowedTags", "nonTextTags", "selfClosing"}
    map_fields = {"allowedAttributes", "allowedClasses"}
    for field, setting in value.items():
        if field not in CleanConfig.__annotations__:
            raise ValueError("unknown cleaning config field")
        if field in array_fields:
            if not _string_list(setting):
                raise TypeError(f"config.{field} must be a list of strings")
            if not all(_tag_name(item) for item in setting):
                raise ValueError(f"config.{field} must contain lowercase HTML tag names")
            if field == "selfClosing" and any(item not in VOID_TAGS for item in setting):
                raise ValueError("selfClosing supports only standard HTML void tags")
            continue
        if field in map_fields:
            if not isinstance(setting, dict) or not all(
                isinstance(tag, str) and _string_list(names) for tag, names in setting.items()
            ):
                raise TypeError(f"config.{field} must map strings to lists of strings")
            continue
        if not isinstance(setting, dict) or not all(
            _tag_name(tag) and _tag_name(target) for tag, target in setting.items()
        ):
            raise TypeError("config.transformTags must map lowercase tag names to tag names")
