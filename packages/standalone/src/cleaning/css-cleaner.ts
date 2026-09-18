// SPDX-License-Identifier: Apache-2.0
// First-party CSS policy and source-preserving escape analysis. The decoded view is used
// only for detection; no decoded escape sequence is emitted into the cleaned stylesheet.

interface ShadowCss {
  text: string;
  offsets: Int32Array;
}
interface Edit {
  start: number;
  end: number;
  replacement: string;
}

function withoutComments(css: string): string {
  const parts: string[] = [];
  let position = 0;
  while (position < css.length) {
    const opening = css.indexOf('/*', position);
    if (opening < 0) {
      parts.push(css.slice(position));
      break;
    }
    parts.push(css.slice(position, opening), ' ');
    const closing = css.indexOf('*/', opening + 2);
    if (closing < 0) break;
    position = closing + 2;
  }
  return parts.join('').replace(/<!--|-->/g, ' ');
}

/** Resolve CSS Syntax escapes into a shadow string, mapping each UTF-16 unit to source. */
function shadow(source: string): ShadowCss {
  const offsets = new Int32Array(source.length + 1);
  let text = '';
  let position = 0;
  const emit = (value: string, start: number): void => {
    for (let unit = 0; unit < value.length; unit += 1) offsets[text.length + unit] = start;
    text += value;
  };
  while (position < source.length) {
    const start = position;
    const current = source[position] ?? '';
    const following = source[position + 1];
    if (current !== '\\' || following === undefined || /[\n\r\f]/.test(following)) {
      emit(current, start);
      position += 1;
      continue;
    }
    const digits = /^[0-9a-fA-F]{1,6}/.exec(source.slice(position + 1, position + 7))?.[0];
    if (digits === undefined) {
      emit(following, start);
      position += 2;
      continue;
    }
    position += 1 + digits.length;
    if (source[position] === '\r' && source[position + 1] === '\n') position += 2;
    else if (/[ \t\n\r\f]/.test(source[position] ?? '')) position += 1;
    const point = Number.parseInt(digits, 16);
    emit(
      point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(point),
      start,
    );
  }
  offsets[text.length] = source.length;
  return { text, offsets };
}

function allowedUrl(argument: string): boolean {
  const value = argument.trim().toLowerCase();
  if (!value || value.includes('\\')) return false;
  if (value.startsWith('//')) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(value)?.[1];
  return scheme === undefined || scheme === 'http' || scheme === 'https';
}

/** Apply nonoverlapping edits in source order, avoiding repeated rebuilding of the suffix. */
function edited(source: string, edits: Edit[]): string {
  edits.sort((left, right) => left.start - right.start || right.end - left.end);
  const parts: string[] = [];
  let consumed = 0;
  for (const edit of edits) {
    if (edit.start < consumed) continue;
    parts.push(source.slice(consumed, edit.start), edit.replacement);
    consumed = edit.end;
  }
  parts.push(source.slice(consumed));
  return parts.join('');
}

/** Remove imports, bindings, expressions and disallowed URL schemes from a CSS string. */
export function cleanCss(css: string): string {
  if (!css) return css;
  const source = withoutComments(css);
  const { text, offsets } = shadow(source);
  const edits: Edit[] = [];
  const record = (match: RegExpExecArray, replacement: string): void => {
    const start = match.index;
    edits.push({
      start: offsets[start] ?? source.length,
      end: offsets[start + match[0].length] ?? source.length,
      replacement,
    });
  };
  for (const pattern of [
    /@import[^;]*;?/gi,
    /-moz-binding\s*:[^;]*;?/gi,
    /expression\s*\([^;}{]*\)*/gi,
  ]) {
    for (const match of text.matchAll(pattern)) record(match, '');
  }
  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)*/gi)) {
    if (!allowedUrl(match[1] ?? match[2] ?? match[3] ?? '')) record(match, "url('')");
  }
  return edited(source, edits);
}

function attributeText(value: string): string {
  const entities: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };
  return value.replace(
    /&(amp|lt|gt|quot|apos|#0*39|#x0*27);/gi,
    (_match, name: string) => entities[name.toLowerCase()] ?? "'",
  );
}

function quotedAttribute(value: string): string {
  const entities: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;',
  };
  return value.replace(/[&"<>]/g, (character) => entities[character] ?? character);
}

/** Clean inline CSS and style bodies; the caller re-applies the HTML floor to a fixpoint. */
export function cleanStyledHtml(html: string): string {
  const attributes = html.replace(
    /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (_match, prefix: string, _quoted: string, double?: string, single?: string) =>
      `${prefix}"${quotedAttribute(cleanCss(attributeText(double ?? single ?? '')))}"`,
  );
  return attributes.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_match, opening: string, body: string, closing: string) => opening + cleanCss(body) + closing,
  );
}
