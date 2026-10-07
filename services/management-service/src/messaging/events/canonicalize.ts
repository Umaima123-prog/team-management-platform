/**
 * Deterministic JSON serialization: object keys are sorted recursively
 * before stringifying, so two envelopes with identical logical content
 * always produce byte-identical output regardless of property
 * insertion order. "Deterministic where practical" per the assignment
 * - this does not attempt canonical number/float formatting (not
 * needed here; every numeric field in the envelope is a plain integer
 * or ISO date string).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function encodeEnvelopeToBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJsonStringify(value));
}
