import {
  XMWriter,
  createModule,
  createPattern,
  createInstrument,
  XMEffects,
  XMPatternNote,
} from '../src';

describe('XMWriter Feature Verification', () => {
  describe('Volume Handling', () => {
    let writer: XMWriter;

    beforeEach(() => {
      writer = new XMWriter();
    });

    // Helper to get the packed bytes for a single note in a pattern
    const getPackedNoteBytes = (noteConfig: Partial<XMPatternNote>): Uint8Array => {
      const module = createModule({});
      const pattern = createPattern(1, 1);

      // Apply config
      Object.assign(pattern.data[0][0], noteConfig);

      module.patterns.push(pattern);
      module.header.numberOfPatterns = 1;
      module.header.numberOfChannels = 1;

      const buffer = writer.write(module);
      const view = new Uint8Array(buffer);

      // We need to find the pattern data.
      // The XM header is calculated as follows:
      // Fixed header part 1: 60 bytes (ID, names, version)
      // Header Size field: 4 bytes (value is 276)
      // Rest of header: 272 bytes (276 - 4) ?? No, usually Header Size includes itself?
      // Let's re-calculate based on writeHeader:
      // 17 (ID) + 20 (Name) + 1 (1A) + 20 (Tracker) + 2 (Version) = 60 bytes.
      // 4 (Header Size) + 2 (Song Len) + 2 (Restart) + 2 (Channels) + 2 (Patterns) + 2 (Instruments) + 2 (Flags) + 2 (Tempo) + 2 (BPM) + 256 (Order Table) = 276 bytes.
      // Total Header Size = 60 + 276 = 336 bytes.

      // Pattern Header is 9 bytes.
      // Data starts at 336 + 9 = 345.

      const dataStart = 345;

      // Read the first byte of data (flags or first byte)
      // Since we only have 1 row and 1 channel, and we are looking at the first note,
      // the bytes starting at dataStart are the packed note.

      // We can just return the slice of data that corresponds to the note.
      // Since we don't know the length easily without parsing, let's just return enough bytes.
      return view.slice(dataStart, dataStart + 10);
    };

    it('should write nothing (0x00) when volume is undefined', () => {
      const bytes = getPackedNoteBytes({}); // volume is undefined
      // If nothing is set (note=0, inst=0, vol=undef, effect=0),
      // packNote returns 0x80 (only packed flag)
      // But actually, if everything is 0/empty, packNote returns 0x80.
      expect(bytes[0] & 0x80).toBe(0x80);
      // Check volume bit (0x04) is NOT set
      expect(bytes[0] & 0x04).toBe(0);
    });

    it('should write 0x10 when volume is 0 (Silence)', () => {
      const bytes = getPackedNoteBytes({ volume: 0 });
      // Volume bit (0x04) should be set
      expect(bytes[0] & 0x04).toBe(0x04);

      // Find where volume byte is.
      // It depends on other flags. Here only volume is set.
      // Flags: 0x80 | 0x04 = 0x84
      expect(bytes[0]).toBe(0x84);
      // Next byte is volume
      expect(bytes[1]).toBe(0x10);
    });

    it('should write 0x50 when volume is 64 (Max)', () => {
      const bytes = getPackedNoteBytes({ volume: 64 });
      expect(bytes[0] & 0x04).toBe(0x04);
      expect(bytes[1]).toBe(0x50); // 64 + 0x10 = 0x50
    });

    it('should write 0x11 when volume is 1', () => {
      const bytes = getPackedNoteBytes({ volume: 1 });
      expect(bytes[1]).toBe(0x11);
    });

    it('should write raw byte when volumeEffect is set', () => {
      const bytes = getPackedNoteBytes({ volumeEffect: 0xA0 });
      expect(bytes[0] & 0x04).toBe(0x04);
      expect(bytes[1]).toBe(0xA0);
    });

    it('should throw error when both volume and volumeEffect are set', () => {
      expect(() => {
        getPackedNoteBytes({ volume: 32, volumeEffect: 0x10 });
      }).toThrow('Cannot set both volume and volumeEffect on the same note');
    });
  });

  describe('Validation', () => {
    it('should throw error if channels > 32', () => {
      const module = createModule({ numberOfChannels: 33 });
      const writer = new XMWriter();
      expect(() => writer.write(module)).toThrow('Number of channels cannot exceed 32');
    });

    it('should throw error if patterns > 256', () => {
      const module = createModule({});
      module.header.numberOfPatterns = 257;
      const writer = new XMWriter();
      expect(() => writer.write(module)).toThrow('Number of patterns cannot exceed 256');
    });

    it('should throw error if instruments > 128', () => {
      const module = createModule({});
      module.header.numberOfInstruments = 129;
      const writer = new XMWriter();
      expect(() => writer.write(module)).toThrow('Number of instruments cannot exceed 128');
    });
  });

  describe('XMEffects Enum', () => {
    it('should have correct values', () => {
      expect(XMEffects.Arpeggio).toBe(0x0);
      expect(XMEffects.VolumeSlide).toBe(0xA);
      expect(XMEffects.PositionJump).toBe(0xB);
      expect(XMEffects.SetVolume).toBe(0xC);
    });
  });
});
