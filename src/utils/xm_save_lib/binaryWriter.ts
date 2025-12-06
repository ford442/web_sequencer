/**
 * Binary buffer writer for XM file format
 * All multi-byte values are little-endian
 */
export class BinaryWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private uint8: Uint8Array;
  private offset: number = 0;

  /**
   * Create a new binary writer with the specified buffer size
   * @param size Initial buffer size in bytes
   */
  constructor(size: number = 1024) {
    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
    this.uint8 = new Uint8Array(this.buffer);
  }

  /**
   * Ensure the buffer has enough capacity for the specified number of bytes
   * @param additionalBytes Number of additional bytes needed
   */
  private ensureCapacity(additionalBytes: number): void {
    const requiredSize = this.offset + additionalBytes;
    if (requiredSize > this.buffer.byteLength) {
      // Double the buffer size until it's big enough
      let newSize = this.buffer.byteLength * 2;
      while (newSize < requiredSize) {
        newSize *= 2;
      }
      const newBuffer = new ArrayBuffer(newSize);
      const newUint8 = new Uint8Array(newBuffer);
      newUint8.set(this.uint8);
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer);
      this.uint8 = newUint8;
    }
  }

  /**
   * Write an unsigned 8-bit integer
   * @param value Value to write (0-255)
   */
  writeUint8(value: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  /**
   * Write a signed 8-bit integer
   * @param value Value to write (-128 to 127)
   */
  writeInt8(value: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.offset, value);
    this.offset += 1;
  }

  /**
   * Write an unsigned 16-bit integer (little-endian)
   * @param value Value to write (0-65535)
   */
  writeUint16(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  /**
   * Write a signed 16-bit integer (little-endian)
   * @param value Value to write (-32768 to 32767)
   */
  writeInt16(value: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
  }

  /**
   * Write an unsigned 32-bit integer (little-endian)
   * @param value Value to write (0-4294967295)
   */
  writeUint32(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  /**
   * Write a fixed-length string, padded with zeros
   * @param str String to write
   * @param length Fixed length of the string field
   */
  writeString(str: string, length: number): void {
    this.ensureCapacity(length);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str.substring(0, length));
    this.uint8.set(bytes, this.offset);
    // Pad with zeros
    for (let i = bytes.length; i < length; i++) {
      this.uint8[this.offset + i] = 0;
    }
    this.offset += length;
  }

  /**
   * Write raw bytes
   * @param bytes Bytes to write
   */
  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    this.uint8.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  /**
   * Write zeros
   * @param count Number of zero bytes to write
   */
  writeZeros(count: number): void {
    this.ensureCapacity(count);
    // Already initialized to 0, just advance offset
    this.offset += count;
  }

  /**
   * Get the current write position
   * @returns Current offset in bytes
   */
  getPosition(): number {
    return this.offset;
  }

  /**
   * Set the current write position
   * @param position New offset in bytes
   */
  setPosition(position: number): void {
    this.offset = position;
  }

  /**
   * Get the final buffer trimmed to the actual size
   * @returns Buffer containing only the written data
   */
  getBuffer(): ArrayBuffer {
    return this.buffer.slice(0, this.offset);
  }

  /**
   * Get the buffer as a Uint8Array
   * @returns Uint8Array containing only the written data
   */
  getUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.offset);
  }

  /**
   * Overwrite 16-bit value at specific position without advancing offset
   * @param position Position to write at
   * @param value Value to write
   */
  writeUint16At(position: number, value: number): void {
    this.view.setUint16(position, value, true);
  }
}
