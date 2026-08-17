/** Canonical JSON (sorted keys) so integrity hashes are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortValue(obj[key]);
    }
    return out;
  }
  return value;
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** FNV-1a 32-bit — used in unit tests when SubtleCrypto is unavailable. */
export function fnv1a32Hex(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function hashBytes(bytes: Uint8Array): Promise<{ alg: 'sha256' | 'fnv1a32'; value: string }> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const digest = await subtle.digest('SHA-256', ab);
    return { alg: 'sha256', value: toHex(digest) };
  }
  return { alg: 'fnv1a32', value: fnv1a32Hex(bytes) };
}

export async function hashCanonicalJson(value: unknown): Promise<{ alg: 'sha256' | 'fnv1a32'; value: string }> {
  const encoded = new TextEncoder().encode(canonicalJson(value));
  return hashBytes(encoded);
}

export function integrityMatches(
  expected: { alg: string; value: string },
  actual: { alg: string; value: string },
): boolean {
  return expected.alg === actual.alg && expected.value === actual.value;
}
