# SPDX-License-Identifier: Apache-2.0
# Extraction options derived from Trafilatura v2.2.0 (Apache-2.0), revision
# c1bc9531a2a978326112ca9987e1382745116136:
#   trafilatura/settings.py::Extractor
#   https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/settings.py
# Copyright Adrien Barbaresi and Trafilatura contributors.
# Modified: represented extraction options with a Python dataclass.
"""Internal extraction options; public validation remains in _options."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class Options:
    """The three focus modes and upstream-shaped content switches."""

    focus: Literal["precision", "balanced", "recall"] = "balanced"
    url: str | None = None
    include_links: bool = True
    include_images: bool = True
    include_tables: bool = True
    include_comments: bool = True
    include_formatting: bool = True
