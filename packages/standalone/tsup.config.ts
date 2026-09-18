// SPDX-License-Identifier: Apache-2.0

import { access, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'tsup';

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * `trafilaturacore` is pure TypeScript: the extraction core is `src/core/`, so there is no
 * native addon to redirect, stage, or verify. This bundles the whole shell into `dist/` and
 * copies the canonical compact notice to `dist/THIRD-PARTY-NOTICES.txt`. Public deps
 * (sanitize-html, parse5, entities, …) stay external regular `dependencies`. Types
 * come from `tsc --emitDeclarationOnly`, so no api-extractor rollup is needed.
 */
export default defineConfig({
  entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Declarations come from `tsc -p tsconfig.build.json --emitDeclarationOnly` (the build
  // script), so a plain tsc dts suffices.
  dts: false,
  clean: true,
  sourcemap: false,
  // Split shared code into chunks emitted into the dist/ root so cli.ts's own
  // `isMainEntry(import.meta.url)` check stays in the cli entry chunk.
  splitting: true,
  // tsup auto-externalizes `dependencies` but NOT `optionalDependencies`. The hardened
  // DOMPurify/jsdom backend is opt-in and heavy (jsdom ~5 MB) — keep it external so it is
  // resolved from node_modules only when a consumer installs it.
  external: ['dompurify', 'jsdom'],
  banner: {
    // Give the ESM output a `require` for any bundled CJS access. The aliased name avoids
    // colliding with source-level createRequire imports.
    js: "import { createRequire as __bundleCreateRequire } from 'node:module'; const require = __bundleCreateRequire(import.meta.url);",
  },
  async onSuccess() {
    // The bundled CLI needs the canonical compact notices beside its dist output.
    const notices = path.join(__dirname, '..', '..', 'THIRD-PARTY-NOTICES.txt');
    if (!(await exists(notices))) {
      throw new Error(`tsup: could not locate THIRD-PARTY-NOTICES.txt at ${notices}`);
    }
    await copyFile(notices, path.join(__dirname, 'dist', 'THIRD-PARTY-NOTICES.txt'));
  },
});
