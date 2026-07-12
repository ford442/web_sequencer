import type { ParserBinaryContext } from './parserContext';

export function readNullTerminatedString(ctx: ParserBinaryContext, offset: number, maxLength: number): string {
  let result = '';
  for (let i = 0; i < maxLength; i++) {
    const byte = ctx.rawBytes[offset + i];
    if (byte === 0) break;
    if (byte >= 32 && byte < 127) {
      result += String.fromCharCode(byte);
    }
  }
  return result.trim();
}

export function readAsciiString(ctx: ParserBinaryContext, offset: number, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const byte = ctx.rawBytes[offset + i];
    if (byte >= 32 && byte < 127) {
      result += String.fromCharCode(byte);
    }
  }
  return result;
}

export function convertSignedByte(value: number): number {
  return value > 127 ? value - 256 : value;
}

export function convertSignedByteWithOffset(value: number, offset: number): number {
  return convertSignedByte(value) - offset;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
