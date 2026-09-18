# SPDX-License-Identifier: Apache-2.0
"""Errors from the native extraction and cleaning boundary."""

from __future__ import annotations


class TrafilaturacoreError(Exception):
    """Base error for native extraction and cleaning failures."""


class ResourceLimitError(TrafilaturacoreError, ValueError):
    """Input or intermediate output exceeded a deterministic processing limit."""

    code = "ERR_TRAFILATURACORE_RESOURCE_LIMIT"
