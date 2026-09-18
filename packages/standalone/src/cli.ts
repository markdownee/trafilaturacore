#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// trafilaturacore CLI entry point. Offline-only: reads HTML from a file or stdin and
// writes cleaned HTML (or JSON) to stdout/file. It NEVER fetches the network.

import { buildProgram, isMainEntry, runCli } from './cli-program.js';

export { buildProgram } from './cli-program.js';

export const program = buildProgram();

if (isMainEntry(import.meta.url)) {
  await runCli(program, process.argv);
}
