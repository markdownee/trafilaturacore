# Dependency replacements

One transitive dependency of `trafilaturacore` declares a licence in
`package.json` but publishes no copyright-and-permission notice in any released
tarball. Rather than distribute it on a bare metadata declaration, a pnpm
override installs the licence-clean module in this directory in its place, so
the package is not resolved into any Trafilatura Core graph or shipped in any
Trafilatura Core artifact.

| Replaced        | Reached through        | Replacement | Why                                                                                        |
| --------------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `launder@1.7.1` | `sanitize-html@2.17.7` | `launder/`  | No published release ships a notice. Removing it also drops its unused `dayjs` dependency. |

This is not a workspace package. It is a plain directory consumed as a `file:`
dependency, so the workspace globs must not match it.

`launder` has no exit. `sanitize-html@2.17.7` still requires it, no `launder`
release ships a notice, and every `launder`-free `sanitize-html` carries an
unpatched advisory — the `launder`-free ceiling `2.17.3` has a CVSS 9.3
default-config XSS.

## What used to be here: `boolbase`

`boolbase@1.0.0` was replaced the same way, reached through
`linkedom` → `css-select@5.2.2` and `nth-check@2.1.1`. It was retired on
2026-08-07 by **elimination at the source** rather than by override:
`trafilaturacore` no longer depends on `linkedom` (the metadata sidecar's DOM is
now backed by `parse5`, which the package already used), so no Trafilatura Core graph
reaches `css-select`, `nth-check`, or `boolbase` at all.

That closes an exposure an override could not reach. Overrides live in the
workspace and **do not travel with a published tarball**, so a downstream
`npm i trafilaturacore` still resolved the real notice-less `boolbase@1.0.0`.
Measured from a packed tarball installed with plain `npm`: the dependencies-only
closure went from 61 packages / 33 MB carrying `boolbase@1.0.0` and
`launder@1.7.1`, to 47 packages / 27 MB carrying `launder@1.7.1` alone.

`css-select` still reaches this monorepo through `svgo` and `cheerio-select`,
whose graphs now resolve upstream `boolbase@1.0.0`. That is deliberate and
unchanged in substance: `cheerio-select`'s own direct `boolbase` dependency was
never overridden either, because those graphs are outside the Trafilatura Core
distribution boundary.

`boolbase@2.0.0` does ship the full ISC text, but is ESM-only with no default
export, so it could never have satisfied either consumer's default import.

## Where the override lives

Both install contexts need their own declaration, because their workspace roots
differ:

- `@/pnpm-workspace.yaml` — the tools root development workspace.
- `@/solutions/trafilaturacore/engine/pnpm-workspace.release.yaml` — becomes the
  public mirror's `pnpm-workspace.yaml` on sync, and so also governs the
  wheel-staging `pnpm deploy --legacy … --config.allow-unused-patches=true`
  flow that produces `_vendor/cli/node_modules`.

A `pnpm.overrides` block in a root `package.json` silently shadows
`pnpm-workspace.yaml` overrides. The mirror's root `package.json` is
mirror-owned and is never synced from here, so it must not introduce one: that
would re-admit the package into the released graph without any local signal.

## Maintenance obligation

**The override key is scoped, not version-bounded.** `sanitize-html>launder`
names one parent, but constrains the version of neither the parent nor the
child. The failure mode this creates is worse than a range that stops matching:
a bumped `sanitize-html` **keeps** matching and silently receives this shim, even
if upstream's own `launder` usage or the dangerous-href check it carries has
moved on. Nothing fails; the behaviour just quietly goes stale.

So **bumping `sanitize-html` requires revisiting this directory**. After any such
bump, re-run the absence proof (no upstream `launder` in the lockfiles,
`node_modules`, and any TypeScript `pnpm deploy` tree) and diff `sanitize-html`'s href sanitization path.

`launder/index.js` carries the upstream dangerous-href check, so upstream changes
to that check are **this repository's responsibility to track**: mirror any
security fix here. The parity suite at
`@/solutions/trafilaturacore/engine/packages/standalone/src/cleaning/dangerous-href.test.ts`
is the gate, and it resolves the module through `sanitize-html` itself so it
fails when the override stops applying. Native Python dependencies install separately and no
longer vendor this JavaScript graph; Python artifact inspection rejects bundled product JavaScript.

The replacement may not be turned into a manufactured notice for the package it
replaces. It exists precisely so no notice has to be invented for code whose
rights holder never published one. Its own original code carries its own notice
in `launder/LICENSE`.
