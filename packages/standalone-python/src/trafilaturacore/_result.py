# SPDX-License-Identifier: Apache-2.0
"""Native result models; metadata keys match the language-neutral JSON sidecar."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict


class Metadata(TypedDict, total=False):
    """Page declarations and extracted metadata, never a classifier verdict."""

    title: str
    author: str
    url: str
    hostname: str
    description: str
    sitename: str
    date: str
    categories: list[str]
    tags: list[str]
    image: str
    declaredPageType: str
    license: str


@dataclass(frozen=True)
class Message:
    """A non-fatal pipeline diagnostic without raw input or exception contents."""

    type: Literal["info", "warning", "error"]
    text: str


@dataclass(frozen=True)
class CleanResult:
    """Cleaned HTML, diagnostics, and optional metadata from supplied HTML."""

    html: str
    messages: list[Message]
    metadata: Metadata | None = None
    declared_page_type: str | None = None
