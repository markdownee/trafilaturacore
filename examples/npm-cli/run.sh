#!/usr/bin/env bash
# Demonstrates the full npm CLI surface for trafilaturacore.
# Requires: npm install -g trafilaturacore
# (or swap `trafilaturacore` for `npx trafilaturacore`)
#
# trafilaturacore is OFFLINE: HTML in -> cleaned HTML out. It never fetches the
# network, so there is no URL to crawl. Input is a file argument or stdin; the
# `--url` flag is context only (metadata + image-URL resolution) and is never
# fetched.
set -euo pipefail

SAMPLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/sample.html"

# Help (truncated — drop `| head -5` to see all flags)
trafilaturacore --help | head -5
trafilaturacore --version

# File in -> cleaned HTML on stdout. Default mode is `balanced`.
trafilaturacore "$SAMPLE" | head -20

# stdin -> stdout, so it pipes cleanly (diagnostics go to stderr)
cat "$SAMPLE" | trafilaturacore -b balanced | head -10

# The four boilerplate modes. `keep` skips main-content
# extraction entirely and only sanitizes + normalizes the whole document
# (extraction is never run).
trafilaturacore "$SAMPLE" --boilerplate precision | head -5
trafilaturacore "$SAMPLE" --boilerplate recall    | head -5
trafilaturacore "$SAMPLE" --boilerplate keep      | head -5

# Content modes default to include. Exclusion is explicit and user-comment
# sections are removed structurally.
trafilaturacore "$SAMPLE" --image-handling exclude --link-handling exclude | head -10
trafilaturacore "$SAMPLE" --table-handling exclude --comment-handling exclude | head -10

# Full result as JSON: html + metadata + messages
trafilaturacore "$SAMPLE" --json | head -20

# Write to a file instead of stdout
trafilaturacore "$SAMPLE" --output ./cleaned.html
ls cleaned.html

# Source URL for metadata / image-resolution context ONLY — never fetched
trafilaturacore "$SAMPLE" \
  --url https://example.com/blog/how-boilerplate-removal-works \
  --json | head -10

# A custom cleaning config REPLACES the default Trafilatura-aligned config.
# It is JSON (never YAML). The cleaning stage also filters <script>,
# on* handlers, and dangerous URL schemes when a custom config is supplied.
cat > ./clean-config.json <<'JSON'
{
  "allowedTags": ["h1", "h2", "p", "a", "ul", "li", "strong", "em"],
  "allowedAttributes": { "a": ["href"] }
}
JSON
trafilaturacore "$SAMPLE" --config ./clean-config.json | head -10

# Quiet: suppress the diagnostics on stderr
trafilaturacore "$SAMPLE" --quiet | head -3

rm -f ./cleaned.html ./clean-config.json
echo "done"
