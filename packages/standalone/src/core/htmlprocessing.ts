// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/htmlprocessing.py
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/htmlprocessing.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: fresh TypeScript translation of cleaning, link-density and conversion stages;
// caller-enabled deduplication is absent from this product. Bottom-up density summaries,
// batched edits and lexical URL resolution are first-party implementations of the
// established behavior, not imports from Courlan or another transitive dependency.

import type { Options } from './options.js';
import type { Rule } from './selectors.js';
import {
  CUT_EMPTY_ELEMS,
  MANUALLY_CLEANED,
  MANUALLY_STRIPPED,
  PRESERVE_IMG_CLEANING,
} from './settings.js';
import { charCount, type NodeId, type Tree } from './tree.js';
import {
  isImageElement,
  isPySpaceCode,
  LINK_FARM_RATIO,
  textfilter,
  trim,
  trimOrNone,
} from './utils.js';

/** Python htmlprocessing.py::REND_TAG_MAPPING, including its insertion order. */
export const REND_TAG_MAPPING: readonly (readonly [string, string])[] = [
  ['em', '#i'],
  ['i', '#i'],
  ['b', '#b'],
  ['strong', '#b'],
  ['u', '#u'],
  ['kbd', '#t'],
  ['samp', '#t'],
  ['tt', '#t'],
  ['var', '#t'],
  ['sub', '#sub'],
  ['sup', '#sup'],
];

export function treeCleaning(tree: Tree, root: NodeId, options: Options): NodeId {
  let remove = [...MANUALLY_CLEANED];
  let unwrap = [...MANUALLY_STRIPPED];
  if (options.include_tables) {
    for (const id of tree.collectDescendants(root)) {
      if (tree.tag(id) === 'figure' && tree.findDescendant(id, 'table') !== undefined) {
        tree.setTag(id, 'div');
      } else if (
        tree.tag(id) === 'table' &&
        ['presentation', 'none'].includes(tree.getOrEmpty(id, 'role'))
      ) {
        tree.setTag(id, 'div');
      }
    }
  } else remove.push('table', 'td', 'th', 'tr');
  if (options.include_images) {
    remove = remove.filter((tag) => !PRESERVE_IMG_CLEANING.includes(tag));
    unwrap = unwrap.filter((tag) => tag !== 'img');
  }
  tree.stripTags(root, unwrap);
  const backup =
    options.focus === 'recall' && tree.findDescendant(root, 'p') !== undefined
      ? tree.deepCopy(root)
      : undefined;
  for (const tag of remove) tree.deleteAllWithTagLxml(root, tag);
  return pruneHtml(
    tree,
    backup !== undefined && tree.findDescendant(root, 'p') === undefined ? backup : root,
    options.focus,
  );
}

export function pruneHtml(tree: Tree, root: NodeId, focus: Options['focus']): NodeId {
  const empty = tree.collectDescendantsWhere(
    root,
    (id) =>
      tree.childCount(id) === 0 && tree.text(id) === undefined && CUT_EMPTY_ELEMS.has(tree.tag(id)),
  );
  tree.deleteElementsBatch(empty, focus !== 'precision');
  return root;
}

export function pruneUnwantedNodes(
  tree: Tree,
  root: NodeId,
  rules: readonly Rule[],
  withBackup: boolean,
): NodeId {
  const originalLength = withBackup ? charCount(tree.itertext(root)) : 0;
  const backup = withBackup ? tree.deepCopy(root) : undefined;
  for (const rule of rules) {
    tree.deleteElementsBatch(
      tree.collectDescendantsWhere(root, (id) => rule(tree, id)),
      true,
    );
  }
  return backup !== undefined && charCount(tree.itertext(root)) <= originalLength / 7
    ? backup
    : root;
}

/** A constant-size summary of concatenated text after Python whitespace normalization. */
interface TextMeasure {
  length: number;
  present: boolean;
  leading: boolean;
  trailing: boolean;
}
interface Density {
  text: TextMeasure;
  links: number;
  nonempty: number;
  short: number;
  linkChars: number;
  graphic: boolean;
}
function measure(text: string | undefined): TextMeasure {
  const value = text ?? '';
  return {
    length: charCount(trim(value)),
    present: value.length > 0,
    leading: isPySpaceCode(value.charCodeAt(0)),
    trailing: isPySpaceCode(value.charCodeAt(value.length - 1)),
  };
}
function concatenate(left: TextMeasure, right: TextMeasure): TextMeasure {
  if (!left.present) return { ...right };
  if (!right.present) return left;
  return {
    present: true,
    leading: left.leading,
    trailing: right.trailing,
    length:
      left.length +
      right.length +
      (left.length > 0 && right.length > 0 && (left.trailing || right.leading) ? 1 : 0),
  };
}

/** First-party linear aggregation; no subtree text is rescanned for each nested candidate. */
function densitySnapshot(tree: Tree, root: NodeId): (Density | undefined)[] {
  const snapshot: (Density | undefined)[] = new Array(tree.length);
  const order = tree.collectTree(root);
  for (let position = order.length - 1; position >= 0; position -= 1) {
    const id = order[position];
    if (id === undefined) continue;
    const stats: Density = {
      text: measure(tree.text(id)),
      links: 0,
      nonempty: 0,
      short: 0,
      linkChars: 0,
      graphic: false,
    };
    for (const child of tree.children(id)) {
      const nested = snapshot[child];
      if (nested === undefined) continue;
      stats.text = concatenate(concatenate(stats.text, nested.text), measure(tree.tail(child)));
      stats.links += nested.links;
      stats.nonempty += nested.nonempty;
      stats.short += nested.short;
      stats.linkChars += nested.linkChars;
      stats.graphic ||= nested.graphic || tree.tag(child) === 'graphic';
      if (tree.tag(child) === 'ref') {
        stats.links += 1;
        if (nested.text.length > 0) {
          stats.nonempty += 1;
          stats.short += nested.text.length < 10 ? 1 : 0;
          stats.linkChars += nested.text.length;
        }
      }
    }
    snapshot[id] = stats;
  }
  return snapshot;
}

export function cachedTrimmedTextChars(tree: Tree, root: NodeId): (number | undefined)[] {
  return densitySnapshot(tree, root).map((value) => value?.text.length);
}

/** Python link_density_test thresholds, shared by direct and cached evaluation. */
function densityDecision(
  tree: Tree,
  id: NodeId,
  stats: Density,
  precise: boolean,
): { dense: boolean; collect: boolean } {
  if (stats.links === 0 || stats.graphic) return { dense: false, collect: false };
  const length = stats.text.length;
  if (stats.links === 1 && stats.linkChars > (precise ? 10 : 100) && stats.linkChars > length * 0.9)
    return { dense: true, collect: false };
  const last = tree.nextSibling(id) === undefined;
  const limit = tree.tag(id) === 'p' ? (last ? 60 : 30) : last ? 300 : 100;
  if (length < limit) {
    return {
      dense:
        stats.nonempty === 0 ||
        stats.linkChars > length * 0.8 ||
        (stats.nonempty > 1 && stats.short / stats.nonempty > 0.8),
      collect: true,
    };
  }
  const dense =
    stats.links > 4 &&
    stats.linkChars > length * LINK_FARM_RATIO &&
    stats.linkChars < 100 * stats.nonempty;
  return { dense, collect: dense };
}

export function linkDensityTest(
  tree: Tree,
  element: NodeId,
  text: string,
  favorPrecision: boolean,
): { dense: boolean; texts: string[] } {
  const links = tree.collectDescendantsByTag(element, ['ref']);
  if (!links.length || tree.findDescendant(element, 'graphic') !== undefined) {
    return { dense: false, texts: [] };
  }
  const texts = links.map((node) => trim(tree.itertext(node))).filter(Boolean);
  const lengths = texts.map(charCount);
  const stats: Density = {
    text: { ...measure(text), length: charCount(text) },
    links: links.length,
    nonempty: texts.length,
    short: lengths.filter((length) => length < 10).length,
    linkChars: lengths.reduce((sum, length) => sum + length, 0),
    graphic: false,
  };
  const decision = densityDecision(tree, element, stats, favorPrecision);
  return { dense: decision.dense, texts: decision.collect ? texts : [] };
}

export function linkDensityTestTables(tree: Tree, element: NodeId): boolean {
  const links = tree.collectDescendantsByTag(element, ['ref']);
  if (!links.length) return false;
  const length = charCount(trim(tree.itertext(element)));
  if (length < 200) return false;
  let linked = 0;
  for (const node of links) linked += charCount(trim(tree.itertext(node)));
  return linked > length * (length < 1000 ? 0.8 : 0.5);
}

export function deleteByLinkDensity(
  tree: Tree,
  subtree: NodeId,
  tagname: string,
  backtracking: boolean,
  favorPrecision: boolean,
): NodeId {
  const candidates = tree.collectTreeWhere(subtree, (node) => tree.tag(node) === tagname);
  if (!candidates.length) return subtree;
  const snapshot = densitySnapshot(tree, subtree);
  const remove: NodeId[] = [];
  for (const node of candidates) {
    const stats = snapshot[node];
    if (stats === undefined) continue;
    const decision = densityDecision(tree, node, stats, favorPrecision);
    const backtrack =
      backtracking &&
      decision.collect &&
      stats.nonempty > 0 &&
      stats.text.length > 0 &&
      stats.text.length < (favorPrecision ? 200 : 100) &&
      tree.childCount(node) >= (favorPrecision ? 1 : 3);
    if (!decision.dense && !backtrack) continue;
    const parent = tree.parent(node);
    if (tagname === 'p' && parent !== undefined && ['item', 'td', 'th'].includes(tree.tag(parent)))
      continue;
    remove.push(node);
  }
  tree.deleteElementsBatch(remove, true);
  return subtree;
}

function emptyNode(tree: Tree, id: NodeId): boolean {
  return (
    tree.isDone(id) ||
    (tree.childCount(id) === 0 && tree.text(id) === undefined && tree.tail(id) === undefined)
  );
}

export function handleTextnode(
  tree: Tree,
  elem: NodeId,
  commentsFix: boolean,
  preserveSpaces: boolean,
): NodeId | undefined {
  if (tree.tag(elem) === 'graphic' && isImageElement(tree, elem)) return elem;
  if (emptyNode(tree, elem)) return undefined;
  if (!commentsFix && tree.tag(elem) === 'lb') {
    if (!preserveSpaces) tree.setTail(elem, trimOrNone(tree.tail(elem)));
    return elem;
  }
  if (tree.text(elem) === undefined && tree.childCount(elem) === 0) {
    tree.setText(elem, tree.tail(elem));
    tree.setTail(elem, '');
    if (commentsFix && tree.tag(elem) === 'lb') tree.setTag(elem, 'p');
  }
  if (!preserveSpaces) {
    tree.setText(elem, trimOrNone(tree.text(elem)));
    if (tree.tail(elem)) tree.setTail(elem, trimOrNone(tree.tail(elem)));
  }
  return !tree.text(elem) && textfilter(tree, elem) ? undefined : elem;
}

export function processNode(tree: Tree, elem: NodeId): NodeId | undefined {
  if (emptyNode(tree, elem)) return undefined;
  tree.setText(elem, trimOrNone(tree.text(elem)));
  tree.setTail(elem, trimOrNone(tree.tail(elem)));
  if (tree.tag(elem) !== 'lb' && tree.text(elem) === undefined && tree.tail(elem) !== undefined) {
    tree.setText(elem, tree.tail(elem));
    tree.setTail(elem, undefined);
  }
  return (tree.text(elem) !== undefined || tree.tail(elem) !== undefined) && textfilter(tree, elem)
    ? undefined
    : elem;
}

/** First-party lexical URL components; preserve ports and backslashes without network access. */
interface UrlReference {
  scheme: string | undefined;
  authority: string | undefined;
  path: string;
  query: string | undefined;
  fragment: string | undefined;
}
function urlParts(value: string): UrlReference {
  const match =
    /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#([\s\S]*))?$/.exec(
      value,
    );
  return {
    scheme: match?.[1],
    authority: match?.[2] || undefined,
    path: match?.[3] ?? value,
    query: match?.[4],
    fragment: match?.[5],
  };
}
function urlText(parts: UrlReference): string {
  const prefix =
    (parts.scheme === undefined ? '' : `${parts.scheme}:`) +
    (parts.authority === undefined ? '' : `//${parts.authority}`);
  const slash =
    parts.authority !== undefined && parts.path && !parts.path.startsWith('/') ? '/' : '';
  return (
    prefix +
    slash +
    parts.path +
    (parts.query ? `?${parts.query}` : '') +
    (parts.fragment ? `#${parts.fragment}` : '')
  );
}
function normalizedPath(path: string, collapse: boolean): string {
  const pieces = path.split('/');
  if (!collapse && !pieces.includes('.') && !pieces.includes('..')) return path;
  const resolved: string[] = [];
  for (const piece of pieces) {
    if (!piece || piece === '.') continue;
    if (piece === '..') resolved.pop();
    else resolved.push(piece);
  }
  let value = (path.startsWith('/') ? '/' : '') + resolved.join('/');
  if ((path.endsWith('/') || path.endsWith('/.') || path.endsWith('/..')) && !value.endsWith('/')) {
    value += '/';
  }
  return value;
}

export function joinUrlCompat(base: string, target: string): string {
  if (!base || !target) return target || base;
  const relative = urlParts(target);
  if (relative.scheme !== undefined) return target;
  const origin = urlParts(base);
  if (relative.authority !== undefined) return urlText({ ...relative, scheme: origin.scheme });
  if (!relative.path) {
    return urlText({
      ...origin,
      query: relative.query ?? origin.query,
      fragment: relative.fragment,
    });
  }
  const directory =
    origin.authority !== undefined && !origin.path
      ? '/'
      : origin.path.slice(0, origin.path.lastIndexOf('/') + 1);
  const path = relative.path.startsWith('/')
    ? normalizedPath(relative.path, false)
    : normalizedPath(directory + relative.path, true);
  return urlText({ ...relative, scheme: origin.scheme, authority: origin.authority, path });
}

export function fixRelativeUrls(baseUrl: string, target: string): string {
  if (target.startsWith('{')) return target;
  const destination = urlParts(target);
  if (
    destination.authority !== undefined &&
    destination.authority !== urlParts(baseUrl).authority
  ) {
    return destination.scheme === undefined ? `http:${target}` : target;
  }
  return joinUrlCompat(baseUrl, target);
}

function conversion(tree: Tree, id: NodeId): void {
  const tag = tree.tag(id);
  if (['dl', 'ol', 'ul'].includes(tag)) {
    tree.set(id, 'rend', tag);
    tree.setTag(id, 'list');
    let count = 1;
    for (const child of tree.collectDescendantsByTag(id, ['dd', 'dt', 'li'])) {
      const kind = tree.tag(child);
      if (kind === 'dd' || kind === 'dt') {
        tree.set(child, 'rend', `${kind}-${count}`);
        if (kind === 'dd') count += 1;
      }
      tree.setTag(child, 'item');
    }
  } else if (/^h[1-6]$/.test(tag)) {
    tree.clearAttrs(id);
    tree.set(id, 'rend', tag);
    tree.setTag(id, 'head');
  } else if (tag === 'br' || tag === 'hr') {
    tree.setTag(id, 'lb');
  } else if (tag === 'pre' || tag === 'blockquote' || tag === 'q') {
    let code = false;
    if (tag === 'pre') {
      const first = tree.children(id)[0];
      code = first !== undefined && tree.childCount(id) === 1 && tree.tag(first) === 'span';
      const spans = tree.collectDescendantsWhere(
        id,
        (node) => tree.tag(node) === 'span' && tree.getOrEmpty(node, 'class').startsWith('hljs'),
      );
      for (const span of spans) tree.clearAttrs(span);
      code ||=
        spans.length > 0 ||
        ['{', '("', "('", '\n    '].some((indicator) => (tree.text(id) ?? '').includes(indicator));
    }
    tree.setTag(id, code ? 'code' : 'quote');
  } else if (['del', 's', 'strike'].includes(tag)) {
    tree.setTag(id, 'del');
    tree.set(id, 'rend', 'overstrike');
  } else if (tag === 'details') {
    tree.setTag(id, 'div');
    for (const child of tree.collectDescendantsByTag(id, ['summary'])) tree.setTag(child, 'head');
  }
}

export function convertTags(
  tree: Tree,
  root: NodeId,
  options: Options,
  url: string | undefined,
): NodeId {
  if (options.include_links) {
    const parsed = url === undefined ? undefined : urlParts(url);
    const base =
      parsed?.scheme !== undefined && parsed.authority !== undefined
        ? `${parsed.scheme}://${parsed.authority}`
        : undefined;
    for (const id of tree.collectDescendantsByTag(root, ['a', 'ref'])) {
      const target = tree.get(id, 'href');
      tree.setTag(id, 'ref');
      tree.clearAttrs(id);
      if (target)
        tree.set(id, 'target', base === undefined ? target : fixRelativeUrls(base, target));
    }
  } else {
    for (const id of tree.collectDescendantsByTag(root, ['a'])) {
      if (
        ['div', 'li', 'p'].some((tag) => tree.hasAncestor(id, tag)) ||
        (options.include_tables && tree.hasAncestor(id, 'table'))
      )
        tree.setTag(id, 'ref');
    }
    tree.stripTags(root, ['a']);
  }
  for (const id of tree.collectDescendantsWhere(
    root,
    (node) =>
      tree.tag(node) === 'strong' && tree.getOrEmpty(node, 'class').includes('schema-faq-question'),
  )) {
    tree.clearAttrs(id);
    tree.set(id, 'rend', 'h3');
    tree.setTag(id, 'head');
  }
  const empty = tree.collectDescendantsWhere(
    root,
    (id) =>
      ['sub', 'sup'].includes(tree.tag(id)) &&
      tree.text(id) === undefined &&
      tree.childCount(id) === 0,
  );
  tree.deleteElementsBatch(empty, true);
  const formatting = new Map(REND_TAG_MAPPING);
  if (options.include_formatting) {
    for (const id of tree.collectDescendantsByTag(root, [...formatting.keys()])) {
      const rend = formatting.get(tree.tag(id)) ?? '#i';
      tree.clearAttrs(id);
      tree.set(id, 'rend', rend);
      tree.setTag(id, 'hi');
    }
  } else tree.stripTags(root, [...formatting.keys()]);
  const convertible = [
    'dl',
    'ol',
    'ul',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'br',
    'hr',
    'blockquote',
    'pre',
    'q',
    'del',
    's',
    'strike',
    'details',
  ];
  for (const id of tree.collectDescendantsByTag(root, convertible)) conversion(tree, id);
  if (options.include_images) {
    for (const id of tree.collectDescendantsByTag(root, ['img'])) tree.setTag(id, 'graphic');
    if (options.include_links) {
      const moves: (readonly [NodeId, NodeId[]])[] = [];
      const claimed = new Set<NodeId>();
      for (const ref of tree.collectDescendantsByTag(root, ['ref'])) {
        const graphics = tree.collectDescendantsByTag(ref, ['graphic']).filter((id) => {
          if (claimed.has(id)) return false;
          claimed.add(id);
          return true;
        });
        if (graphics.length) moves.push([ref, graphics]);
      }
      tree.moveGroupsAfter(moves);
      tree.deleteElementsBatch(
        moves.map(([ref]) => ref).filter((ref) => !trim(tree.itertext(ref))),
        true,
      );
    }
  }
  return root;
}
