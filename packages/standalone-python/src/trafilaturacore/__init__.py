# SPDX-License-Identifier: Apache-2.0
"""Trafilatura Core: a native Python library for supplied-HTML extraction and cleaning."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from ._errors import ResourceLimitError, TrafilaturacoreError
from ._options import (
    BOILERPLATE_MODES,
    COMMENT_HANDLING_MODES,
    DEFAULT_BOILERPLATE_MODE,
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
)
from ._result import CleanResult, Message, Metadata
from ._run import aclean, clean


def _installed_version() -> str:
    """Read the native distribution version without requiring an installed wheel."""
    try:
        return version("trafilaturacore")
    except PackageNotFoundError:  # pragma: no cover - source checkout without install
        return "0+unknown"


__version__ = _installed_version()

__all__ = [
    "BOILERPLATE_MODES",
    "COMMENT_HANDLING_MODES",
    "DEFAULT_BOILERPLATE_MODE",
    "DEFAULT_MAX_INPUT_BYTES",
    "IMAGE_HANDLING_MODES",
    "LINK_HANDLING_MODES",
    "TABLE_HANDLING_MODES",
    "BoilerplateMode",
    "CleanConfig",
    "CleanResult",
    "CommentHandlingMode",
    "ImageHandlingMode",
    "LinkHandlingMode",
    "Message",
    "Metadata",
    "ResourceLimitError",
    "TableHandlingMode",
    "TrafilaturacoreError",
    "__version__",
    "aclean",
    "clean",
]
