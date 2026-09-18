// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_PACKAGE_RELATIVE = 'solutions/trafilaturacore/engine/packages/standalone';
const MIRROR_PACKAGE_RELATIVE = 'packages/standalone';
export const TOOLS_MATERIALIZED_INPUT_PATHS = ['pnpm-lock.yaml'];
export const MIRROR_MATERIALIZED_INPUT_PATHS = ['pnpm-lock.yaml'];

// The engine is pure TypeScript: there is no Cargo manifest or lock to bind, and no native
// artifact, build mode, or source-build evidence to record. What remains is the source and
// payload identity the external tester verifies.
export const TOOLS_SOURCE_INPUT_PATHS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'solutions/trafilaturacore/engine/THIRD-PARTY-NOTICES.txt',
  'solutions/trafilaturacore/engine/package.json',
  'solutions/trafilaturacore/engine/pnpm-workspace.release.yaml',
  'solutions/trafilaturacore/engine/tsconfig.json',
  'solutions/trafilaturacore/engine/turbo.json',
  TOOLS_PACKAGE_RELATIVE,
];

export const MIRROR_SOURCE_INPUT_PATHS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'turbo.json',
  'THIRD-PARTY-NOTICES.txt',
  MIRROR_PACKAGE_RELATIVE,
];

/**
 * The two supported source layouts. Annotated rather than inferred because a bare object literal
 * widens `name` and `sourceStatusScope` to `string`, which loses the part of the contract callers
 * actually depend on.
 *
 * @typedef {object} BuildLayout
 * @property {'tools' | 'release-mirror'} name
 * @property {string} packageRelative
 * @property {readonly string[]} sourceInputPaths
 * @property {readonly string[]} materializedInputPaths
 * @property {'tracked' | 'tracked-and-untracked'} sourceStatusScope
 */

/** @type {readonly BuildLayout[]} */
const LAYOUTS = [
  {
    name: 'tools',
    packageRelative: TOOLS_PACKAGE_RELATIVE,
    sourceInputPaths: TOOLS_SOURCE_INPUT_PATHS,
    // The tools workspace follows the repository-wide ignored-lock convention.
    // The root lock is nevertheless a real build input, so bind its bytes without
    // incorrectly requiring it to be tracked.
    materializedInputPaths: TOOLS_MATERIALIZED_INPUT_PATHS,
    sourceStatusScope: 'tracked-and-untracked',
  },
  {
    name: 'release-mirror',
    packageRelative: MIRROR_PACKAGE_RELATIVE,
    sourceInputPaths: MIRROR_SOURCE_INPUT_PATHS,
    // The release mirror deliberately owns no committed pnpm lock. `pnpm install`
    // materializes one before the build; it is a real input, so hash it. Other
    // untracked workflow materializations are outside the tracked source scope.
    materializedInputPaths: MIRROR_MATERIALIZED_INPUT_PATHS,
    sourceStatusScope: 'tracked',
  },
];

/** @type {(left: string, right: string) => number} */
const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
/** @type {(value: string) => string} */
const normalizeRelative = (value) => value.split(path.sep).join('/');

/**
 * @param {string} directory
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function filesUnder(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => comparePaths(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(path.join(directory, entry.name), relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`unsupported non-file entry in trafilaturacore build: ${relative}`);
    }
  }
  return files;
}

/**
 * @param {string} root
 * @param {readonly string[]} files
 * @param {string} header
 * @returns {Promise<{ sha256: string, files: number }>}
 */
async function digestFiles(root, files, header) {
  const hash = createHash('sha256');
  hash.update(`${header}\0`);
  for (const relative of [...files].sort(comparePaths)) {
    const content = await readFile(path.join(root, relative));
    hash.update(`${Buffer.byteLength(relative)}\0${relative}\0${content.byteLength}\0`);
    hash.update(content);
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), files: files.length };
}

/**
 * @param {string} packageDir
 * @returns {Promise<{ sha256: string, files: number }>}
 */
export async function digestBuildPayload(packageDir) {
  const distFiles = (await filesUnder(path.join(packageDir, 'dist')))
    .filter((relative) => relative !== 'build-provenance.json')
    .map((relative) => `dist/${relative}`);
  if (distFiles.length === 0) {
    throw new Error('trafilaturacore build produced no dist payload');
  }
  // The manifest is deliberately absent: it is bound separately, by `packageJsonSha256` as
  // built and by `publishedManifestSha256` as shipped. Hashing its bytes here as well made
  // the payload digest describe a file the release never publishes, because the npm release
  // strips `devDependencies` from the manifest after this build and before packing.
  return digestFiles(
    packageDir,
    ['LICENSE', 'README.md', ...distFiles],
    'trafilaturacore-build-payload-v1',
  );
}

// Key-sorted JSON, so a digest survives a rewrite that only reorders or reformats.
/**
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(/** @type {Record<string, unknown>} */ (value)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Digest the manifest as it is actually published.
 *
 * The npm release runs `npm pkg delete devDependencies` after the build, because the
 * `workspace:*` specifiers must never ship. That rewrite happens after this provenance is
 * written, so a digest over the as-built bytes describes a manifest no consumer receives.
 * Projecting the field away — and comparing canonical JSON rather than bytes, since npm
 * reformats what it rewrites — gives consumers a value they can recompute from the
 * published package.
 *
 * @param {Buffer} packageJsonBytes
 * @returns {string}
 */
export function digestPublishedManifest(packageJsonBytes) {
  const manifest = JSON.parse(packageJsonBytes.toString('utf8'));
  delete manifest.devDependencies;
  return createHash('sha256')
    .update(`trafilaturacore-published-manifest-v1\0${canonicalJson(manifest)}`)
    .digest('hex');
}

/**
 * @param {string} repoRoot
 * @param {readonly string[]} args
 * @returns {Promise<string>}
 */
async function git(repoRoot, args) {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * @param {string} repoRoot
 * @param {string} packageDir
 * @returns {BuildLayout}
 */
export function resolveBuildLayout(repoRoot, packageDir) {
  const packageRelative = normalizeRelative(path.relative(repoRoot, packageDir));
  const layout = LAYOUTS.find((candidate) => candidate.packageRelative === packageRelative);
  if (!layout) {
    throw new Error(`unsupported trafilaturacore source layout: ${packageRelative || '.'}`);
  }
  return layout;
}

/**
 * @param {string} repoRoot
 * @param {BuildLayout} layout
 * @returns {Promise<{ sha256: string, files: number }>}
 */
async function digestSourceInputs(repoRoot, layout) {
  const output = await git(repoRoot, ['ls-files', '-z', '--', ...layout.sourceInputPaths]);
  const tracked = output === '' ? [] : output.split('\0').filter(Boolean);
  const packageFiles = tracked.filter(
    (relative) =>
      relative === layout.packageRelative || relative.startsWith(`${layout.packageRelative}/`),
  );
  if (packageFiles.length === 0) {
    throw new Error(`build provenance package source is not tracked: ${layout.packageRelative}`);
  }
  const requiredTrackedFiles = layout.sourceInputPaths.filter(
    (relative) =>
      relative !== layout.packageRelative && !layout.materializedInputPaths.includes(relative),
  );
  for (const relative of requiredTrackedFiles) {
    if (!tracked.includes(relative)) {
      throw new Error(`build provenance source input is not tracked: ${relative}`);
    }
  }

  const files = [...new Set([...tracked, ...layout.materializedInputPaths])].sort(comparePaths);
  const hash = createHash('sha256');
  hash.update('trafilaturacore-source-inputs-v1\0');
  for (const relative of files) {
    const content = await readFile(path.join(repoRoot, relative));
    hash.update(`${Buffer.byteLength(relative)}\0${relative}\0${content.byteLength}\0`);
    hash.update(content);
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), files: files.length };
}

/**
 * @typedef {object} SourceSnapshot
 * @property {string} sourceGitSha
 * @property {string} sourceGitTree
 * @property {string} status
 * @property {string} sourceInputsSha256
 * @property {number} sourceInputFiles
 */

/**
 * @param {string} repoRoot
 * @param {BuildLayout} layout
 * @returns {Promise<SourceSnapshot>}
 */
async function collectStableSourceSnapshot(repoRoot, layout) {
  // Git identity/status and the complete declared input digest are sampled on both sides. This
  // refuses a mixed snapshot when a checkout or source file changes while provenance is collected.
  const sourceGitSha = await git(repoRoot, ['rev-parse', 'HEAD']);
  const sourceGitTree = await git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  const status = await git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const sourceInputs = await digestSourceInputs(repoRoot, layout);
  const repeatedInputs = await digestSourceInputs(repoRoot, layout);
  const repeatedStatus = await git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const repeatedGitSha = await git(repoRoot, ['rev-parse', 'HEAD']);
  const repeatedGitTree = await git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  if (
    sourceGitSha !== repeatedGitSha ||
    sourceGitTree !== repeatedGitTree ||
    status !== repeatedStatus ||
    sourceInputs.sha256 !== repeatedInputs.sha256 ||
    sourceInputs.files !== repeatedInputs.files
  ) {
    throw new Error(
      'trafilaturacore build provenance: source checkout changed while collecting identity',
    );
  }
  return {
    sourceGitSha,
    sourceGitTree,
    status,
    sourceInputsSha256: sourceInputs.sha256,
    sourceInputFiles: sourceInputs.files,
  };
}

/**
 * @param {SourceSnapshot} left
 * @param {SourceSnapshot} right
 * @returns {boolean}
 */
function sameSourceSnapshot(left, right) {
  return (
    left.sourceGitSha === right.sourceGitSha &&
    left.sourceGitTree === right.sourceGitTree &&
    left.status === right.status &&
    left.sourceInputsSha256 === right.sourceInputsSha256 &&
    left.sourceInputFiles === right.sourceInputFiles
  );
}

/**
 * @param {string} status
 * @param {BuildLayout['sourceStatusScope']} sourceStatusScope
 * @returns {boolean}
 */
function sourceTreeIsClean(status, sourceStatusScope) {
  if (status === '') return true;
  if (sourceStatusScope === 'tracked') {
    return status.split('\n').every((line) => line.startsWith('?? '));
  }
  return false;
}

/**
 * @typedef {object} BuildProvenance
 * @property {1} schemaVersion
 * @property {string} sourceGitSha
 * @property {string} sourceGitTree
 * @property {'tracked' | 'tracked-and-untracked'} sourceStatusScope
 * @property {boolean} sourceTreeClean
 * @property {string} sourceInputsSha256
 * @property {number} sourceInputFiles
 * @property {string} packageJsonSha256
 * @property {string} publishedManifestSha256
 * @property {string} buildPayloadSha256
 * @property {number} buildPayloadFiles
 */

/**
 * @param {{ repoRoot?: string, packageDir?: string }} [options]
 * @returns {Promise<BuildProvenance>}
 */
export async function collectBuildProvenance({ repoRoot, packageDir } = {}) {
  const resolvedPackageDir = packageDir ?? HERE;
  const resolvedRepoRoot =
    repoRoot ?? (await git(resolvedPackageDir, ['rev-parse', '--show-toplevel']));
  const layout = resolveBuildLayout(resolvedRepoRoot, resolvedPackageDir);
  const sourceSnapshot = await collectStableSourceSnapshot(resolvedRepoRoot, layout);
  const packageJson = await readFile(path.join(resolvedPackageDir, 'package.json'));
  const buildPayload = await digestBuildPayload(resolvedPackageDir);
  const repeatedBuildPayload = await digestBuildPayload(resolvedPackageDir);
  const repeatedPackageJson = await readFile(path.join(resolvedPackageDir, 'package.json'));
  const repeatedSourceSnapshot = await collectStableSourceSnapshot(resolvedRepoRoot, layout);
  if (
    !sameSourceSnapshot(sourceSnapshot, repeatedSourceSnapshot) ||
    !packageJson.equals(repeatedPackageJson) ||
    buildPayload.sha256 !== repeatedBuildPayload.sha256 ||
    buildPayload.files !== repeatedBuildPayload.files
  ) {
    throw new Error(
      'trafilaturacore build provenance: source checkout or build payload changed while binding identity',
    );
  }
  return {
    schemaVersion: 1,
    sourceGitSha: sourceSnapshot.sourceGitSha,
    sourceGitTree: sourceSnapshot.sourceGitTree,
    sourceStatusScope: layout.sourceStatusScope,
    sourceTreeClean: sourceTreeIsClean(sourceSnapshot.status, layout.sourceStatusScope),
    sourceInputsSha256: sourceSnapshot.sourceInputsSha256,
    sourceInputFiles: sourceSnapshot.sourceInputFiles,
    packageJsonSha256: createHash('sha256').update(packageJson).digest('hex'),
    publishedManifestSha256: digestPublishedManifest(packageJson),
    buildPayloadSha256: buildPayload.sha256,
    buildPayloadFiles: buildPayload.files,
  };
}

/**
 * @param {{ repoRoot?: string, packageDir?: string }} [options]
 * @returns {Promise<BuildProvenance>}
 */
export async function writeBuildProvenance(options = {}) {
  const packageDir = options.packageDir ?? HERE;
  const provenance = await collectBuildProvenance({ ...options, packageDir });
  const output = path.join(packageDir, 'dist', 'build-provenance.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(provenance, null, 2)}\n`);
  return provenance;
}

/**
 * The one environment variable that may suppress provenance, and the one value that does it.
 *
 * Provenance is collected from Git, so a build with no repository to read cannot produce it.
 * That is not a hypothetical: the Markdownee Actor image builds this package inside a
 * Docker build context, where no `COPY` places a repository in the image and none can
 * usefully be added. Such a build sets this variable to say so deliberately.
 *
 * The gate is an allowlist of exactly one value rather than a truthiness check, so a stray
 * `0`, `false`, or empty string cannot silently disable the binding. Unset — which is what
 * every release build leaves it — collects provenance and fails the build when it cannot,
 * which is the guarantee the npm and PyPI channels rest on.
 */
export const BUILD_PROVENANCE_ENV = 'TRAFILATURACORE_BUILD_PROVENANCE';
export const BUILD_PROVENANCE_SKIP_VALUE = 'skip';

/**
 * `repoRoot` and `packageDir` are named here because the rest element forwards them to
 * `writeBuildProvenance`, where a caller cannot otherwise see that they are accepted.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   warn?: (message: string) => void,
 *   repoRoot?: string,
 *   packageDir?: string,
 * }} [options]
 * @returns {Promise<{ skipped: boolean }>}
 */
export async function runBuildProvenanceCli({
  env = process.env,
  warn = console.warn,
  ...options
} = {}) {
  if (env[BUILD_PROVENANCE_ENV] === BUILD_PROVENANCE_SKIP_VALUE) {
    warn(
      `${BUILD_PROVENANCE_ENV}=${BUILD_PROVENANCE_SKIP_VALUE}: skipping dist/build-provenance.json. ` +
        'This build is not publishable to npm or PyPI.',
    );
    return { skipped: true };
  }
  await writeBuildProvenance(options);
  return { skipped: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBuildProvenanceCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
