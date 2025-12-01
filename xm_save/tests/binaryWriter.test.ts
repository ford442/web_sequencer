import { BinaryWriter } from '../src/binaryWriter';

describe('BinaryWriter', () => {
  let writer: BinaryWriter;

  beforeEach(() => {
    writer = new BinaryWriter(64);
  });

  describe('writeUint8', () => {
    it('should write a single byte', () => {
      writer.writeUint8(0x42);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(1);
      expect(buffer[0]).toBe(0x42);
    });

    it('should write multiple bytes', () => {
      writer.writeUint8(0x00);
      writer.writeUint8(0xff);
      writer.writeUint8(0x80);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(3);
      expect(buffer[0]).toBe(0x00);
      expect(buffer[1]).toBe(0xff);
      expect(buffer[2]).toBe(0x80);
    });
  });

  describe('writeInt8', () => {
    it('should write signed bytes', () => {
      writer.writeInt8(-1);
      writer.writeInt8(127);
      writer.writeInt8(-128);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(3);
      expect(buffer[0]).toBe(0xff); // -1 as unsigned
      expect(buffer[1]).toBe(127);
      expect(buffer[2]).toBe(0x80); // -128 as unsigned
    });
  });

  describe('writeUint16', () => {
    it('should write little-endian 16-bit values', () => {
      writer.writeUint16(0x1234);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(2);
      expect(buffer[0]).toBe(0x34); // low byte first (little-endian)
      expect(buffer[1]).toBe(0x12); // high byte second
    });

    it('should write maximum value', () => {
      writer.writeUint16(0xffff);
      const buffer = writer.getUint8Array();
      expect(buffer[0]).toBe(0xff);
      expect(buffer[1]).toBe(0xff);
    });
  });

  describe('writeUint32', () => {
    it('should write little-endian 32-bit values', () => {
      writer.writeUint32(0x12345678);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(4);
      expect(buffer[0]).toBe(0x78);
      expect(buffer[1]).toBe(0x56);
      expect(buffer[2]).toBe(0x34);
      expect(buffer[3]).toBe(0x12);
    });
  });

  describe('writeString', () => {
    it('should write a string with padding', () => {
      writer.writeString('Hello', 10);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(10);
      expect(buffer[0]).toBe(72); // 'H'
      expect(buffer[1]).toBe(101); // 'e'
      expect(buffer[2]).toBe(108); // 'l'
      expect(buffer[3]).toBe(108); // 'l'
      expect(buffer[4]).toBe(111); // 'o'
      expect(buffer[5]).toBe(0); // padding
      expect(buffer[9]).toBe(0); // padding
    });

    it('should truncate strings that are too long', () => {
      writer.writeString('This is a very long string', 10);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(10);
      expect(String.fromCharCode(...buffer)).toBe('This is a ');
    });
  });

  describe('writeBytes', () => {
    it('should write raw bytes', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      writer.writeBytes(bytes);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(5);
      expect([...buffer]).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('writeZeros', () => {
    it('should write zero bytes', () => {
      writer.writeUint8(0xff);
      writer.writeZeros(5);
      writer.writeUint8(0xff);
      const buffer = writer.getUint8Array();
      expect(buffer.length).toBe(7);
      expect(buffer[0]).toBe(0xff);
      expect(buffer[1]).toBe(0);
      expect(buffer[5]).toBe(0);
      expect(buffer[6]).toBe(0xff);
    });
  });

  describe('buffer expansion', () => {
    it('should automatically expand buffer when needed', () => {
      const smallWriter = new BinaryWriter(4);
      // Write more than initial capacity
      for (let i = 0; i < 100; i++) {
        smallWriter.writeUint8(i);
      }
      const buffer = smallWriter.getUint8Array();
      expect(buffer.length).toBe(100);
      for (let i = 0; i < 100; i++) {
        expect(buffer[i]).toBe(i);
      }
    });
  });

  describe('getPosition / setPosition', () => {
    it('should track and allow setting position', () => {
      expect(writer.getPosition()).toBe(0);
      writer.writeUint32(0x12345678);
      expect(writer.getPosition()).toBe(4);
      writer.setPosition(0);
      expect(writer.getPosition()).toBe(0);
    });
  });

  describe('writeUint16At', () => {
    it('should overwrite value at specific position', () => {
      writer.writeUint16(0x0000);
      writer.writeUint16(0xffff);
      writer.writeUint16At(0, 0x1234);
      const buffer = writer.getUint8Array();
      expect(buffer[0]).toBe(0x34);
      expect(buffer[1]).toBe(0x12);
      expect(buffer[2]).toBe(0xff);
      expect(buffer[3]).toBe(0xff);
    });
  });
});
