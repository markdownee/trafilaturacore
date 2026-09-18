#!/usr/bin/env bash
# Build native Python artifacts and run the examples from the installed wheel.
# Requirements: uv and Python 3.12. Build/runtime dependencies are downloaded.
set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "${EXAMPLE_DIR}/../.." && pwd)"
WORKTREE_ROOT="$(git -C "${ENGINE_ROOT}" rev-parse --show-toplevel)"
PY_PKG="${ENGINE_ROOT}/packages/standalone-python"
TEMP_ROOT="${WORKTREE_ROOT}/temp"
# Legal staging requires a candidate outside the engine. A standalone checkout
# therefore uses a sibling temp directory; the monorepo uses its root temp/.
if [ "${WORKTREE_ROOT}" = "${ENGINE_ROOT}" ]; then
  TEMP_ROOT="${ENGINE_ROOT}/../temp"
fi
mkdir -p "${TEMP_ROOT}"
RUN_DIR="$(mktemp -d "${TEMP_ROOT}/trafilaturacore-python-example.XXXXXX")"
CANDIDATE="${RUN_DIR}/candidate"
mkdir -p "${CANDIDATE}"
cp -R "${PY_PKG}/src" "${CANDIDATE}/"
if [ -d "${PY_PKG}/tests" ]; then
  cp -R "${PY_PKG}/tests" "${CANDIDATE}/"
fi
cp "${PY_PKG}/pyproject.toml" "${PY_PKG}/README.md" \
  "${PY_PKG}/hatch_build.py" "${PY_PKG}/build-constraints.txt" "${CANDIDATE}/"
uv venv --python 3.12 "${RUN_DIR}/venv"
PYTHON="${RUN_DIR}/venv/bin/python"
uv pip install --python "${PYTHON}" -r "${PY_PKG}/build-constraints.txt"
"${PYTHON}" "${CANDIDATE}/hatch_build.py" --stage-legal-from "${ENGINE_ROOT}"
"${PYTHON}" -m build --no-isolation --outdir "${RUN_DIR}/dist" "${CANDIDATE}"
uv pip install --python "${PYTHON}" "${RUN_DIR}"/dist/trafilaturacore-*.whl

echo ">>> run main.py (sync clean)"
"${PYTHON}" "${EXAMPLE_DIR}/main.py"

echo ">>> run async_example.py (async aclean)"
"${PYTHON}" "${EXAMPLE_DIR}/async_example.py"

echo ">>> artifacts and virtual environment: ${RUN_DIR}"
