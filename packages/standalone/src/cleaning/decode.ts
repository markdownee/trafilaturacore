// SPDX-License-Identifier: Apache-2.0
// First-party byte-decoding policy: BOM, valid UTF-8, then confidence-bounded detection.

import { isUtf8 } from 'node:buffer';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import type { Message } from '../types.js';

interface DecodeBufferResult {
  html: string | undefined;
  messages: Message[];
}

// Longer signatures precede their UTF-16 prefix.
const BOMS = [
  { bytes: [0xff, 0xfe, 0, 0], label: 'UTF-32LE', encoding: 'utf-32le' },
  { bytes: [0, 0, 0xfe, 0xff], label: 'UTF-32BE', encoding: 'utf-32be' },
  { bytes: [0xef, 0xbb, 0xbf], label: 'UTF-8', encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], label: 'UTF-16LE', encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], label: 'UTF-16BE', encoding: 'utf-16be' },
] as const;

export function decodeBuffer(buffer: Buffer): DecodeBufferResult {
  const messages: Message[] = [];
  const fail = (text: string): DecodeBufferResult => {
    messages.push({ type: 'error', text });
    return { html: undefined, messages };
  };
  if (!buffer.length) return { html: '', messages };
  const bom = BOMS.find(({ bytes }) => bytes.every((byte, index) => buffer[index] === byte));
  if (bom !== undefined) {
    if (bom.label !== 'UTF-8') {
      messages.push({
        type: 'info',
        text: `Detected ${bom.label} encoding via BOM, converted to UTF-8`,
      });
    }
    try {
      const data = buffer.subarray(bom.bytes.length);
      return {
        html: bom.label === 'UTF-8' ? data.toString('utf-8') : iconv.decode(data, bom.encoding),
        messages,
      };
    } catch {
      return fail(`Failed to decode ${bom.label} encoded content`);
    }
  }
  if (isUtf8(buffer)) return { html: buffer.toString('utf-8'), messages };
  const detected = chardet.analyse(buffer)?.[0];
  if (detected === undefined)
    return fail('Unable to detect file encoding and content is not valid UTF-8');
  if (detected.confidence < 20) {
    return fail(
      'Low confidence encoding detection (' +
        detected.confidence +
        '% for ' +
        detected.name +
        '), content is not valid UTF-8',
    );
  }
  if (!iconv.encodingExists(detected.name)) {
    return fail(`Detected encoding ${detected.name} is not supported for conversion`);
  }
  try {
    const html = iconv.decode(buffer, detected.name);
    messages.push({
      type: 'info',
      text:
        'Detected ' +
        detected.name +
        ' encoding (' +
        detected.confidence +
        '% confidence), converted to UTF-8',
    });
    return { html, messages };
  } catch (error) {
    return fail(
      'Failed to convert from ' +
        detected.name +
        ' encoding: ' +
        (error instanceof Error ? error.message : 'Unknown error'),
    );
  }
}
