# SPDX-License-Identifier: Apache-2.0
"""Stage the PEP 639 files a wheel or sdist build needs.

The wheel contains native Python product code and no bundled engine or CLI.
Dependencies install separately, so one ``py3-none-any`` product wheel serves
every supported platform.

A disposable candidate must first run
``hatch_build.py --stage-legal-from <engine-root>`` so Hatchling can discover the
two PEP 639 files beside ``pyproject.toml``.

The staging command copies only ``LICENSE`` and ``THIRD-PARTY-NOTICES.txt``. It
refuses to write into the source engine and refuses conflicting candidate bytes.
Standard wheel and sdist builds fail when staging was skipped; editable installs
keep their existing unstaged behavior.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

PROJECT_ROOT = Path(__file__).resolve().parent
LEGAL_NAMES = ("LICENSE", "THIRD-PARTY-NOTICES.txt")


def stage_legal(engine_root: Path, candidate_root: Path = PROJECT_ROOT) -> None:
    """Copy the canonical legal pair into an external disposable candidate."""

    source_root = engine_root.resolve()
    destination_root = candidate_root.resolve()
    if destination_root == source_root or destination_root.is_relative_to(source_root):
        raise RuntimeError("legal staging requires a disposable candidate outside the engine root")

    for name in LEGAL_NAMES:
        source = source_root / name
        destination = destination_root / name
        if not source.is_file():
            raise FileNotFoundError(f"missing canonical legal file: {source}")
        if destination.exists():
            if not destination.is_file() or destination.read_bytes() != source.read_bytes():
                raise FileExistsError(f"refusing conflicting staged legal file: {destination}")
            continue
        shutil.copyfile(source, destination)


def require_staged_legal(project_root: Path = PROJECT_ROOT) -> None:
    """Require both PEP 639 inputs beside the candidate's pyproject.toml."""

    missing = [name for name in LEGAL_NAMES if not (project_root / name).is_file()]
    if missing:
        raise RuntimeError(
            "legal staging was skipped; run hatch_build.py --stage-legal-from <engine-root>; "
            f"missing: {', '.join(missing)}"
        )


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if version == "editable":
            return
        require_staged_legal()
        # The product contains Python source only; dependency wheels own any
        # platform-specific extension modules.


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage-legal-from", required=True, type=Path, metavar="ENGINE_ROOT")
    args = parser.parse_args()
    stage_legal(args.stage_legal_from)


if __name__ == "__main__":
    main()
