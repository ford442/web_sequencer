/**
 * Minimal WASM memory-limits reader (import section + memory section).
 * Used by the standalone JC-303 contract test — no wasm-objdump required.
 */
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

function readU32(buf, offset) {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) throw new Error('uleb128 too long');
  }
  return { value: result >>> 0, next: i };
}

function readLimits(buf, offset) {
  const flags = readU32(buf, offset);
  const min = readU32(buf, flags.next);
  if (flags.value & 0x1) {
    const max = readU32(buf, min.next);
    return { min: min.value, max: max.value, shared: Boolean(flags.value & 0x2), next: max.next };
  }
  return { min: min.value, max: null, shared: Boolean(flags.value & 0x2), next: min.next };
}

function readName(buf, offset) {
  const len = readU32(buf, offset);
  const start = len.next;
  const end = start + len.value;
  return { name: buf.subarray(start, end).toString('utf8'), next: end };
}

/**
 * @returns {{ min: number, max: number | null, shared: boolean, source: 'memory' | 'import' } | null}
 */
export function readWasmMemoryLimits(buf) {
  if (buf.length < 8 || !buf.subarray(0, 4).equals(WASM_MAGIC)) {
    throw new Error('not a WASM module');
  }
  let offset = 8;
  let fromMemory = null;
  let fromImport = null;

  while (offset < buf.length) {
    const id = buf[offset];
    const size = readU32(buf, offset + 1);
    const start = size.next;
    const end = start + size.value;
    if (id === 2) {
      let i = start;
      const count = readU32(buf, i);
      i = count.next;
      for (let n = 0; n < count.value && i < end; n++) {
        const mod = readName(buf, i);
        const name = readName(buf, mod.next);
        const kind = buf[name.next];
        i = name.next + 1;
        if (kind === 0x02) {
          const limits = readLimits(buf, i);
          fromImport = {
            min: limits.min,
            max: limits.max,
            shared: limits.shared,
            source: 'import',
            module: mod.name,
            name: name.name,
          };
          i = limits.next;
        } else if (kind === 0x00) {
          const t = readU32(buf, i);
          i = t.next;
        } else if (kind === 0x01) {
          const limits = readLimits(buf, i);
          i = limits.next;
        } else if (kind === 0x03) {
          const t = readU32(buf, i);
          const mut = buf[t.next];
          i = t.next + 1;
          void mut;
        } else {
          break;
        }
      }
    } else if (id === 5) {
      let i = start;
      const count = readU32(buf, i);
      i = count.next;
      if (count.value > 0) {
        const limits = readLimits(buf, i);
        fromMemory = {
          min: limits.min,
          max: limits.max,
          shared: limits.shared,
          source: 'memory',
        };
      }
    }
    offset = end;
  }

  return fromMemory ?? fromImport;
}
