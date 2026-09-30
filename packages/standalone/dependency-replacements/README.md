# Dependency replacement

The `launder/` directory replaces the `launder@1.7.1` dependency reached through
`sanitize-html@2.17.7`. That dependency publishes no copyright-and-permission
notice. The replacement has its own [license](launder/LICENSE); it does not
manufacture a notice for the upstream package.

A scoped pnpm override, `sanitize-html>launder`, selects this plain directory.
It is not a workspace package. The replacement retains the dangerous-href check
previously implemented inside `sanitize-html` and omits unused date handling.

## Maintenance

The override is not version-bounded. When updating `sanitize-html`, compare its
dangerous-href handling with `launder/index.js` and run
`src/cleaning/dangerous-href.test.ts` from the standalone package's test suite.
That test resolves the dependency through `sanitize-html`, so it detects a
missing override as well as behavior drift.

Check both development and release dependency resolution. pnpm overrides do not
travel with a published npm tarball; do not infer a downstream installation's
dependency graph from the workspace graph. Native Python installs its own
dependencies and does not bundle this JavaScript graph.

The former `boolbase` replacement is unnecessary: the engine uses `parse5`
instead of `linkedom`, removing the `css-select`/`nth-check` path that reached it.
