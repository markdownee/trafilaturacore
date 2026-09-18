// SPDX-License-Identifier: Apache-2.0
// Offline CLI adapter with streaming output and EPIPE handling.

import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { clean } from './index.js';
import {
  type BoilerplateMode,
  type CleanConfig,
  COMMENT_HANDLING_MODES,
  type CommentHandlingMode,
  cleanConfigError,
  DEFAULT_BOILERPLATE_MODE,
  IMAGE_HANDLING_MODES,
  type ImageHandlingMode,
  isBoilerplateMode,
  isCleanConfig,
  LINK_HANDLING_MODES,
  type LinkHandlingMode,
  TABLE_HANDLING_MODES,
  type TableHandlingMode,
} from './types.js';

export interface ResolvedCliOptions {
  input?: string;
  boilerplate: BoilerplateMode;
  config?: string;
  commentHandling?: CommentHandlingMode;
  tableHandling?: TableHandlingMode;
  imageHandling?: ImageHandlingMode;
  linkHandling?: LinkHandlingMode;
  url?: string;
  output?: string;
  json: boolean;
  quiet: boolean;
}

export interface CliIo {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code;
}

class InputError extends Error {}

async function fileText(path: string, kind: 'input' | 'config'): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new InputError(`Error: cannot read ${kind} file '${path}': ${detail(error)}`);
  }
}

async function inputText(path: string | undefined, stdin: Readable): Promise<string> {
  if (path !== undefined && path !== '-') return fileText(path, 'input');
  if ('isTTY' in stdin && stdin.isTTY) {
    throw new InputError('Error: no input. Pass an HTML file argument or pipe HTML to stdin.');
  }
  const chunks: Uint8Array[] = [];
  for await (const value of stdin) {
    const chunk: unknown = value;
    if (chunk instanceof Uint8Array) chunks.push(chunk);
    else if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
    else throw new TypeError('Input stream must provide strings or bytes');
  }
  const html = Buffer.concat(chunks).toString('utf8');
  if (!html) throw new InputError('Error: empty stdin — no HTML to clean.');
  return html;
}

async function configValue(path: string | undefined): Promise<CleanConfig | undefined> {
  if (path === undefined) return undefined;
  const raw = await fileText(path, 'config');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new InputError(`Error: config file '${path}' is not valid JSON: ${detail(error)}`);
  }
  if (isCleanConfig(value)) return value;
  throw new InputError(`Error: invalid cleaning config '${path}': ${cleanConfigError(value)}`);
}

function flush(stream: Writable, content: string): Promise<void> {
  return new Promise((resolveFlush, rejectFlush) => {
    stream.write(content, (error) => {
      if (error && !hasCode(error, 'EPIPE')) rejectFlush(error);
      else resolveFlush();
    });
  });
}

/** Read supplied HTML, clean once and emit the selected representation. */
export async function runClean(options: ResolvedCliOptions, io: CliIo): Promise<number> {
  let html: string;
  let config: CleanConfig | undefined;
  try {
    html = await inputText(options.input, io.stdin);
    config = await configValue(options.config);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
  const result = await clean(html, {
    boilerplate: options.boilerplate,
    config,
    commentHandling: options.commentHandling,
    tableHandling: options.tableHandling,
    imageHandling: options.imageHandling,
    linkHandling: options.linkHandling,
    url: options.url,
  });
  const output = options.json
    ? `${JSON.stringify(
        { html: result.html, metadata: result.metadata, messages: result.messages },
        null,
        2,
      )}\n`
    : result.html;
  if (options.output === undefined) await flush(io.stdout, output);
  else {
    try {
      await writeFile(options.output, output);
    } catch (error) {
      io.stderr.write(`Error: cannot write output file '${options.output}': ${detail(error)}\n`);
      return 1;
    }
    if (!options.quiet) io.stderr.write(`Wrote ${resolve(options.output)}\n`);
  }
  if (!options.quiet && !options.json) {
    for (const message of result.messages) io.stderr.write(`[${message.type}] ${message.text}\n`);
  }
  return 0;
}

function boilerplate(value: string): BoilerplateMode {
  if (isBoilerplateMode(value)) return value;
  throw new Error(
    `Invalid --boilerplate value: '${value}'. Use precision, balanced, recall, or keep.`,
  );
}

function version(): string {
  const manifest: unknown = createRequire(import.meta.url)('../package.json');
  if (
    manifest !== null &&
    typeof manifest === 'object' &&
    'version' in manifest &&
    typeof manifest.version === 'string'
  ) {
    return manifest.version;
  }
  throw new Error('Package manifest has no version');
}

const HANDLING_OPTIONS = [
  [
    '--image-handling <mode>',
    'images: exclude discards image subtrees; alt-text uses src-less <img> placeholders; ' +
      'resolved-url resolves image URLs when a base URL is available (default: include)',
    IMAGE_HANDLING_MODES,
  ],
  [
    '--link-handling <mode>',
    'links: exclude unwraps <a> — anchor text kept, href dropped (default: include)',
    LINK_HANDLING_MODES,
  ],
  [
    '--table-handling <mode>',
    'tables: exclude discards table subtrees including cell text (default: include)',
    TABLE_HANDLING_MODES,
  ],
  [
    '--comment-handling <mode>',
    'user-comment sections: exclude removes detected comment containers (default: include)',
    COMMENT_HANDLING_MODES,
  ],
] as const;

export function buildProgram(): Command {
  const command = new Command('trafilaturacore');
  command.description(
    'Extract main content or clean a whole HTML document. ' +
      'Reads supplied HTML and writes cleaned HTML; does not fetch URLs.',
  );
  command.version(version());
  command.argument('[input]', 'path to an HTML file; omit or use "-" to read HTML from stdin');
  command.option(
    '-b, --boilerplate <mode>',
    'boilerplate-removal mode: precision | balanced | recall | keep',
    boilerplate,
    DEFAULT_BOILERPLATE_MODE,
  );
  command.option(
    '-c, --config <file.json>',
    'custom cleaning config (JSON CleanConfig); replaces the default config',
  );
  for (const [flag, description, choices] of HANDLING_OPTIONS) {
    command.addOption(new Option(flag, description).choices(choices));
  }
  command.option('-u, --url <url>', 'source URL for metadata and image resolution; not fetched');
  command.option('-o, --output <file>', 'write the result to a file instead of stdout');
  command.option('--json', 'emit the full result as pretty JSON (html, metadata, messages)', false);
  command.option('-q, --quiet', 'suppress the diagnostics on stderr', false);
  command.action(async (input: string | undefined, options: Omit<ResolvedCliOptions, 'input'>) => {
    const code = await runClean({ ...options, input }, process);
    if (code) process.exitCode = code;
  });
  return command;
}

function stdoutError(error: unknown): void {
  if (!hasCode(error, 'EPIPE')) throw error;
}

/** Let queued writes flush naturally; Commander help/version remain successful. */
export async function runCli(program: Command, argv: string[]): Promise<void> {
  if (!process.stdout.listeners('error').includes(stdoutError))
    process.stdout.on('error', stdoutError);
  program.exitOverride();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'exitCode' in error &&
      typeof error.exitCode === 'number'
    ) {
      if (error.exitCode) process.exitCode = error.exitCode;
    } else {
      process.exitCode = 1;
      process.stderr.write(`${detail(error)}\n`);
    }
  }
}

export function isMainEntry(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (argv1 === undefined || argv1 === '') return false;
  try {
    const invoked = realpathSync(resolve(argv1));
    const module = fileURLToPath(metaUrl);
    return invoked === module;
  } catch {
    return false;
  }
}
