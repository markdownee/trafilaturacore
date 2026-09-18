// SPDX-License-Identifier: Apache-2.0
// First-party product error contract, reimplemented independently of upstream extractors.

/** Machine-readable identity retained across all resource failures. */
export const RESOURCE_LIMIT_ERROR_CODE = 'ERR_TRAFILATURACORE_RESOURCE_LIMIT';
export type ExtractionErrorKind = 'invalid-option' | 'too-deep' | 'resource-limit';

/** A validation or deterministic resource rejection at the extraction boundary. */
export class ExtractionError extends Error {
  override readonly name = 'ExtractionError';
  readonly kind: ExtractionErrorKind;
  readonly resource?: string;
  readonly limit?: number;
  readonly observed?: number;
  readonly code?: string;

  private constructor(
    kind: ExtractionErrorKind,
    message: string,
    bounds?: { resource?: string; limit: number; observed?: number },
  ) {
    super(message);
    this.kind = kind;
    if (kind !== 'invalid-option') this.code = RESOURCE_LIMIT_ERROR_CODE;
    if (bounds) {
      this.limit = bounds.limit;
      if (bounds.resource !== undefined) this.resource = bounds.resource;
      if (bounds.observed !== undefined) this.observed = bounds.observed;
    }
  }

  static invalidOption(detail: string): ExtractionError {
    return new ExtractionError('invalid-option', `invalid option: ${detail}`);
  }

  static tooDeep(limit: number): ExtractionError {
    return new ExtractionError('too-deep', `input tree too deeply nested (limit ${limit})`, {
      limit,
    });
  }

  static resourceLimit(resource: string, limit: number, observed: number): ExtractionError {
    return new ExtractionError(
      'resource-limit',
      `resource limit exceeded: ${resource} observed ${observed}, limit ${limit}`,
      { resource, limit, observed },
    );
  }

  isResourceLimit(): boolean {
    return this.kind !== 'invalid-option';
  }
}

export function isExtractionError(value: unknown): value is ExtractionError {
  return value instanceof ExtractionError;
}
