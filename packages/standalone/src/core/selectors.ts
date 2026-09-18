// SPDX-License-Identifier: Apache-2.0
// Ported from Trafilatura v2.2.0 (Apache-2.0), revision
// c1bc9531a2a978326112ca9987e1382745116136:
//   trafilatura/xpaths.py
//   trafilatura/settings.py (BASIC_CLEAN_XPATH, _COOKIE_CONSENT_RE)
// https://github.com/adbar/trafilatura/blob/c1bc9531a2a978326112ca9987e1382745116136/trafilatura/xpaths.py
// Copyright Adrien Barbaresi and Trafilatura contributors.
// Modified: freshly translated each pinned XPath into an ordered TypeScript predicate.
// The Rule predicate and Query traversal interface follow go-trafilatura (Apache-2.0), revision
// 67c3f2a1ca17e9a7b9643239d88d5fe25a36b6ed, internal/selector/selector.go.
// https://github.com/markusmobius/go-trafilatura/blob/67c3f2a1ca17e9a7b9643239d88d5fe25a36b6ed/internal/selector/selector.go
// Copyright (C) 2021 Markus Mobius.
// No Go rule body or old Rust/TypeScript predicate supplies this translation.

import { COOKIE_CONSENT_RE } from './settings.js';
import type { NodeId, Tree } from './tree.js';
import { PY_SPACE_CLASS } from './utils.js';

export type Rule = (tree: Tree, id: NodeId) => boolean;

/** XPath converts an attribute union to its first value in source order. */
export function sourceFirstAttr(tree: Tree, id: NodeId, names: readonly string[]): string {
  const node = tree.node(id);
  const index = node.attrNames.findIndex((name) => names.includes(name));
  return node.attrValues[index] ?? '';
}

/** XPath's character-wise translate function. */
export function translate(value: string, from: string, to: string): string {
  let result = '';
  for (const character of value) {
    const index = from.indexOf(character);
    result += index < 0 ? character : (to[index] ?? '');
  }
  return result;
}

function pattern(source: string, flags = ''): RegExp {
  return new RegExp(source.replace(/\\s/g, `[${PY_SPACE_CLASS}]`), `${flags}u`);
}

const PATTERN_0 = pattern(
  '(?:entry|article|art)-content|article__content|article(?:-|__)?body|articleBody|body-text',
  '',
);
const PATTERN_1 = pattern(
  'post[-_]text|post-body|post-?entry|post[-_]?content|postContent|post_inner_wrapper|article-?text|articleText|(?:entry|page|text|article|art)-content|article__content|article(?:-|__)?body|articleBody|ArticleContent|body-text|article__container',
  '',
);
const PATTERN_2 = pattern('^primary|story-body', '');
const PATTERN_3 = pattern('fulltext', 'i');
const PATTERN_4 = pattern(
  '^article |post-bodycopy|story-?content|(?:theme|blog|section|single)-content|single-post|main-column|wpb_text_column|story-body|field-body',
  '',
);
const PATTERN_5 = pattern('content-main|content-body|contentBody', '');
const PATTERN_6 = pattern('content[-_]main|content(?:-|__)body', '');
const PATTERN_7 = pattern('comment-?list', '');
const PATTERN_8 = pattern('comment-page|comments-content|post-comments', '');
const PATTERN_9 = pattern('^comment[s-]', '');
const PATTERN_10 = pattern('^Comments|article-comments', '');
const PATTERN_11 = pattern('^(?:comol|disqus_thread|dsq-comments)', '');
const PATTERN_12 = pattern('^(?:[Cc]omment|comol|disqus_thread|dsq-comments)', '');
const PATTERN_13 = pattern('^[Cc]omment|(?:article|post)-comments', '');
const PATTERN_14 = pattern('cookie', '');
const PATTERN_15 = pattern(
  '^shar|social|viral|newsletter|syndication|tags|sidebar|banner|bread-?crumb|button|author|^(?:jp-|dpsp-content)|bmdh|footer|Footer|share|Share|nav|Nav|menu|related|message-container|premium',
  '',
);
const PATTERN_16 = pattern(
  '^shar|social|viral|newsletter|syndication|tags|sidebar|banner|bread-?crumb|button|author|^(?:nav|post-nav|ZendeskForm)|subnav|avigation|navbar|navbox|menu|bar| ad |-ad-|outbrain|taboola|criteo|paid-?content|widget|footer|Footer|byline|Byline|share-|sociable|embedded|embed|tag-list|consent|modal-content|permission|elated|next-|-stories|most-popular|meta|rating|attachment|timestamp|user-info|user-profile|-icon|article-infos|message-container|slide|viewport|overlay|options|expand|obfuscated|blurred|mol-factbox|yin|zlylin|nfoline',
  '',
);
const PATTERN_17 = pattern('hidden', '');
const PATTERN_18 = pattern('reader-comments|akismet', '');
const PATTERN_19 = pattern(
  '^hide-|comments-title|nocomments|-reply-|message|akismet|suggest-links|-hide-|hide-print| hidden| hide|noprint|notloaded',
  '',
);
const PATTERN_20 = pattern('(^|\\s)link(\\s|$)', '');
const PATTERN_21 = pattern('comments-title|nocomments|-reply-|message|signin', '');
const PATTERN_22 = pattern('^reply-|akismet', '');

/** Ordered predicates translated from xpaths.py::BODY_XPATH. */
export const BODY_RULES: readonly Rule[] = [
  // BODY_XPATH[0]: .//*[self::article or self::div or self::main or self::section][ @class='post' or @class='entry' or @itemprop='articleBody' or @id='articleContent' or re:test(@id, '(?:entry|article|art)-content|article__content|article(?:-|__)?body|articleBody|body-text') or re:test(@class, 'post[-_]text|post-body|post-?entry|post[-_]?content|postContent|post_inner_wrapper|article-?text|articleText|(?:entry|page|text|article|art)-content|article__content|article(?:-|__)?body|articleBody|ArticleContent|body-text|article__container') ][1]
  (tree, id) =>
    (tree.tag(id) === 'article' ||
      tree.tag(id) === 'div' ||
      tree.tag(id) === 'main' ||
      tree.tag(id) === 'section') &&
    (tree.get(id, 'class') === 'post' ||
      tree.get(id, 'class') === 'entry' ||
      tree.get(id, 'itemprop') === 'articleBody' ||
      tree.get(id, 'id') === 'articleContent' ||
      PATTERN_0.test(tree.getOrEmpty(id, 'id')) ||
      PATTERN_1.test(tree.getOrEmpty(id, 'class'))),
  // BODY_XPATH[1]: (.//article)[1]
  (tree, id) => tree.tag(id) === 'article',
  // BODY_XPATH[2]: (.//*[self::article or self::div or self::main or self::section][ @role='article' or @id='article' or @id='story' or @class='postarea' or @class='art-postcontent' or @class='text' or @class='cell' or @class='story' or re:test(@id, '^primary|story-body') or re:test(@class, 'fulltext', 'i') or re:test(@class, '^article |post-bodycopy|story-?content|(?:theme|blog|section|single)-content|single-post|main-column|wpb_text_column|story-body|field-body') ])[1]
  (tree, id) =>
    (tree.tag(id) === 'article' ||
      tree.tag(id) === 'div' ||
      tree.tag(id) === 'main' ||
      tree.tag(id) === 'section') &&
    (tree.get(id, 'role') === 'article' ||
      tree.get(id, 'id') === 'article' ||
      tree.get(id, 'id') === 'story' ||
      tree.get(id, 'class') === 'postarea' ||
      tree.get(id, 'class') === 'art-postcontent' ||
      tree.get(id, 'class') === 'text' ||
      tree.get(id, 'class') === 'cell' ||
      tree.get(id, 'class') === 'story' ||
      PATTERN_2.test(tree.getOrEmpty(id, 'id')) ||
      PATTERN_3.test(tree.getOrEmpty(id, 'class')) ||
      PATTERN_4.test(tree.getOrEmpty(id, 'class'))),
  // BODY_XPATH[3]: (.//*[self::article or self::div or self::main or self::section][ @id='content' or @class='content' or re:test(@id, 'content-main|content-body|contentBody') or re:test(@class, 'content[-_]main|content(?:-|__)body') or contains(translate(@id, 'CM','cm'), 'main-content') or contains(translate(@class, 'CM','cm'), 'main-content') or contains(translate(@class, 'CP','cp'), 'page-content') ])[1]
  (tree, id) =>
    (tree.tag(id) === 'article' ||
      tree.tag(id) === 'div' ||
      tree.tag(id) === 'main' ||
      tree.tag(id) === 'section') &&
    (tree.get(id, 'id') === 'content' ||
      tree.get(id, 'class') === 'content' ||
      PATTERN_5.test(tree.getOrEmpty(id, 'id')) ||
      PATTERN_6.test(tree.getOrEmpty(id, 'class')) ||
      translate(tree.getOrEmpty(id, 'id'), 'CM', 'cm').includes('main-content') ||
      translate(tree.getOrEmpty(id, 'class'), 'CM', 'cm').includes('main-content') ||
      translate(tree.getOrEmpty(id, 'class'), 'CP', 'cp').includes('page-content')),
  // BODY_XPATH[4]: (.//*[self::article or self::div or self::section][ starts-with(@class, 'main') or starts-with(@id, 'main') or starts-with(@role, 'main')])[1]|(.//main)[1]
  (tree, id) =>
    ((tree.tag(id) === 'article' || tree.tag(id) === 'div' || tree.tag(id) === 'section') &&
      (tree.getOrEmpty(id, 'class').startsWith('main') ||
        tree.getOrEmpty(id, 'id').startsWith('main') ||
        tree.getOrEmpty(id, 'role').startsWith('main'))) ||
    tree.tag(id) === 'main',
];

/** Ordered predicates translated from xpaths.py::COMMENTS_XPATH. */
export const COMMENTS_RULES: readonly Rule[] = [
  // COMMENTS_XPATH[0]: .//*[self::div or self::list or self::section][ re:test(@id|@class, 'comment-?list') or re:test(@class, 'comment-page|comments-content|post-comments')]
  (tree, id) =>
    (tree.tag(id) === 'div' || tree.tag(id) === 'list' || tree.tag(id) === 'section') &&
    (PATTERN_7.test(sourceFirstAttr(tree, id, ['id', 'class'])) ||
      PATTERN_8.test(tree.getOrEmpty(id, 'class'))),
  // COMMENTS_XPATH[1]: .//*[self::div or self::section or self::list][ re:test(@id|@class, '^comment[s-]') or re:test(@class, '^Comments|article-comments')]
  (tree, id) =>
    (tree.tag(id) === 'div' || tree.tag(id) === 'section' || tree.tag(id) === 'list') &&
    (PATTERN_9.test(sourceFirstAttr(tree, id, ['id', 'class'])) ||
      PATTERN_10.test(tree.getOrEmpty(id, 'class'))),
  // COMMENTS_XPATH[2]: .//*[self::div or self::section or self::list][ re:test(@id, '^(?:comol|disqus_thread|dsq-comments)')]
  (tree, id) =>
    (tree.tag(id) === 'div' || tree.tag(id) === 'section' || tree.tag(id) === 'list') &&
    PATTERN_11.test(tree.getOrEmpty(id, 'id')),
  // COMMENTS_XPATH[3]: .//*[self::div or self::section][ starts-with(@id, 'social') or contains(@class, 'comment')]
  (tree, id) =>
    (tree.tag(id) === 'div' || tree.tag(id) === 'section') &&
    (tree.getOrEmpty(id, 'id').startsWith('social') ||
      tree.getOrEmpty(id, 'class').includes('comment')),
];

/** Ordered predicates translated from xpaths.py::REMOVE_COMMENTS_XPATH. */
export const REMOVE_COMMENTS_RULES: readonly Rule[] = [
  // REMOVE_COMMENTS_XPATH[0]: .//*[self::div or self::list or self::section or self::details][ re:test(@id, '^(?:[Cc]omment|comol|disqus_thread|dsq-comments)') or re:test(@class, '^[Cc]omment|(?:article|post)-comments')]
  (tree, id) =>
    (tree.tag(id) === 'div' ||
      tree.tag(id) === 'list' ||
      tree.tag(id) === 'section' ||
      tree.tag(id) === 'details') &&
    (PATTERN_12.test(tree.getOrEmpty(id, 'id')) || PATTERN_13.test(tree.getOrEmpty(id, 'class'))),
];

/** Ordered predicates translated from xpaths.py::OVERALL_DISCARD_XPATH. */
export const OVERALL_DISCARD_RULES: readonly Rule[] = [
  // OVERALL_DISCARD_XPATH[0]: .//*[self::div or self::item or self::list or self::p or self::section or self::span][ @data-lp-replacement-content or contains(translate(@role, 'N', 'n'), 'nav') or contains(@data-component, 'MostPopularStories') or re:test(@id|@class, 'cookie') or re:test(@id, '^shar|social|viral|newsletter|syndication|tags|sidebar|banner|bread-?crumb|button|author|^(?:jp-|dpsp-content)|bmdh|footer|Footer|share|Share|nav|Nav|menu|related|message-container|premium') or re:test(@class, '^shar|social|viral|newsletter|syndication|tags|sidebar|banner|bread-?crumb|button|author|^(?:nav|post-nav|ZendeskForm)|subnav|avigation|navbar|navbox|menu|bar| ad |-ad-|outbrain|taboola|criteo|paid-?content|widget|footer|Footer|byline|Byline|share-|sociable|embedded|embed|tag-list|consent|modal-content|permission|elated|next-|-stories|most-popular|meta|rating|attachment|timestamp|user-info|user-profile|-icon|article-infos|message-container|slide|viewport|overlay|options|expand|obfuscated|blurred|mol-factbox|yin|zlylin|nfoline')]
  (tree, id) =>
    (tree.tag(id) === 'div' ||
      tree.tag(id) === 'item' ||
      tree.tag(id) === 'list' ||
      tree.tag(id) === 'p' ||
      tree.tag(id) === 'section' ||
      tree.tag(id) === 'span') &&
    (tree.get(id, 'data-lp-replacement-content') !== undefined ||
      translate(tree.getOrEmpty(id, 'role'), 'N', 'n').includes('nav') ||
      tree.getOrEmpty(id, 'data-component').includes('MostPopularStories') ||
      PATTERN_14.test(sourceFirstAttr(tree, id, ['id', 'class'])) ||
      PATTERN_15.test(tree.getOrEmpty(id, 'id')) ||
      PATTERN_16.test(tree.getOrEmpty(id, 'class'))),
  // OVERALL_DISCARD_XPATH[1]: .//*[@class='comments-title' or starts-with(@id|@class, 'reply-') or re:test(@id|@style, 'hidden') or contains(@style, 'display:none') or contains(@style, 'display: none') or re:test(@id, 'reader-comments|akismet') or re:test(@class, '^hide-|comments-title|nocomments|-reply-|message|akismet|suggest-links|-hide-|hide-print| hidden| hide|noprint|notloaded') or @aria-hidden='true']
  (tree, id) =>
    tree.get(id, 'class') === 'comments-title' ||
    sourceFirstAttr(tree, id, ['id', 'class']).startsWith('reply-') ||
    PATTERN_17.test(sourceFirstAttr(tree, id, ['id', 'style'])) ||
    tree.getOrEmpty(id, 'style').includes('display:none') ||
    tree.getOrEmpty(id, 'style').includes('display: none') ||
    PATTERN_18.test(tree.getOrEmpty(id, 'id')) ||
    PATTERN_19.test(tree.getOrEmpty(id, 'class')) ||
    tree.get(id, 'aria-hidden') === 'true',
];

/** Ordered predicates translated from xpaths.py::TEASER_DISCARD_XPATH. */
export const TEASER_DISCARD_RULES: readonly Rule[] = [
  // TEASER_DISCARD_XPATH[0]: .//*[self::div or self::item or self::list or self::p or self::section or self::span][ contains(translate(@id, 'T', 't'), 'teaser') or contains(translate(@class, 'T', 't'), 'teaser')]
  (tree, id) =>
    (tree.tag(id) === 'div' ||
      tree.tag(id) === 'item' ||
      tree.tag(id) === 'list' ||
      tree.tag(id) === 'p' ||
      tree.tag(id) === 'section' ||
      tree.tag(id) === 'span') &&
    (translate(tree.getOrEmpty(id, 'id'), 'T', 't').includes('teaser') ||
      translate(tree.getOrEmpty(id, 'class'), 'T', 't').includes('teaser')),
];

/** Ordered predicates translated from xpaths.py::PRECISION_DISCARD_XPATH. */
export const PRECISION_DISCARD_RULES: readonly Rule[] = [
  // PRECISION_DISCARD_XPATH[0]: .//header
  (tree, id) => tree.tag(id) === 'header',
  // PRECISION_DISCARD_XPATH[1]: .//*[self::div or self::item or self::list or self::p or self::section or self::span][ contains(@id|@class, 'bottom') or re:test(@id|@class, '(^|\s)link(\s|$)') or contains(@style, 'border')]
  (tree, id) =>
    (tree.tag(id) === 'div' ||
      tree.tag(id) === 'item' ||
      tree.tag(id) === 'list' ||
      tree.tag(id) === 'p' ||
      tree.tag(id) === 'section' ||
      tree.tag(id) === 'span') &&
    (sourceFirstAttr(tree, id, ['id', 'class']).includes('bottom') ||
      PATTERN_20.test(sourceFirstAttr(tree, id, ['id', 'class'])) ||
      tree.getOrEmpty(id, 'style').includes('border')),
];

/** Ordered predicates translated from xpaths.py::DISCARD_IMAGE_ELEMENTS. */
export const DISCARD_IMAGE_RULES: readonly Rule[] = [
  // DISCARD_IMAGE_ELEMENTS[0]: .//*[self::div or self::item or self::list or self::p or self::section or self::span][ contains(@id, 'caption') or contains(@class, 'caption')]
  (tree, id) =>
    (tree.tag(id) === 'div' ||
      tree.tag(id) === 'item' ||
      tree.tag(id) === 'list' ||
      tree.tag(id) === 'p' ||
      tree.tag(id) === 'section' ||
      tree.tag(id) === 'span') &&
    (tree.getOrEmpty(id, 'id').includes('caption') ||
      tree.getOrEmpty(id, 'class').includes('caption')),
];

/** Ordered predicates translated from xpaths.py::COMMENTS_DISCARD_XPATH. */
export const COMMENTS_DISCARD_RULES: readonly Rule[] = [
  // COMMENTS_DISCARD_XPATH[0]: .//*[self::div or self::section][starts-with(@id, 'respond')]
  (tree, id) =>
    (tree.tag(id) === 'div' || tree.tag(id) === 'section') &&
    tree.getOrEmpty(id, 'id').startsWith('respond'),
  // COMMENTS_DISCARD_XPATH[1]: .//cite|.//quote
  (tree, id) => tree.tag(id) === 'cite' || tree.tag(id) === 'quote',
  // COMMENTS_DISCARD_XPATH[2]: .//*[ @class='comments-title' or contains(@style, 'display:none') or re:test(@class, 'comments-title|nocomments|-reply-|message|signin') or re:test(@id|@class, '^reply-|akismet')]
  (tree, id) =>
    tree.get(id, 'class') === 'comments-title' ||
    tree.getOrEmpty(id, 'style').includes('display:none') ||
    PATTERN_21.test(tree.getOrEmpty(id, 'class')) ||
    PATTERN_22.test(sourceFirstAttr(tree, id, ['id', 'class'])),
];

/** First matching descendant; callers apply rules in their upstream order. */
export function selectFirst(tree: Tree, root: NodeId, rule: Rule): NodeId | undefined {
  return tree.findDescendantWhere(root, (id) => rule(tree, id));
}

const COOKIE = pattern(COOKIE_CONSENT_RE, 'i');
const BASIC_TAGS = new Set([
  'aside',
  'fencedframe',
  'footer',
  'script',
  'style',
  'svg',
  'template',
]);
/** Pinned settings.py::BASIC_CLEAN_XPATH, used only by the baseline text strategies. */
export const BASIC_CLEAN_RULES: readonly Rule[] = [
  (tree, id) =>
    BASIC_TAGS.has(tree.tag(id)) ||
    (tree.tag(id) === 'div' && sourceFirstAttr(tree, id, ['class', 'id']).includes('footer')) ||
    COOKIE.test(tree.getOrEmpty(id, 'class')) ||
    COOKIE.test(tree.getOrEmpty(id, 'id')),
];
