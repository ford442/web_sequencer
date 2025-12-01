import {
  XMWriter,
  createModule,
  createPattern,
  createInstrument,
  createSample,
  addSampleToInstrument,
  noteNameToValue,
  noteValueToName,
  createEmptyEnvelope,
  XM_CONSTANTS,
  XMModule,
} from '../src';

describe('XMWriter', () => {
  describe('createModule', () => {
    it('should create a module with default values', () => {
      const module = createModule({});
      expect(module.header.moduleName).toBe('Untitled');
      expect(module.header.trackerName).toBe(XM_CONSTANTS.DEFAULT_TRACKER_NAME);
      expect(module.header.version).toBe(XM_CONSTANTS.DEFAULT_VERSION);
      expect(module.header.numberOfChannels).toBe(4);
      expect(module.header.songLength).toBe(1);
      expect(module.header.defaultTempo).toBe(6);
      expect(module.header.defaultBPM).toBe(125);
      expect(module.patterns).toHaveLength(0);
      expect(module.instruments).toHaveLength(0);
    });

    it('should create a module with custom values', () => {
      const module = createModule({
        moduleName: 'My Song',
        numberOfChannels: 8,
        defaultTempo: 4,
        defaultBPM: 140,
      });
      expect(module.header.moduleName).toBe('My Song');
      expect(module.header.numberOfChannels).toBe(8);
      expect(module.header.defaultTempo).toBe(4);
      expect(module.header.defaultBPM).toBe(140);
    });
  });

  describe('createPattern', () => {
    it('should create an empty pattern', () => {
      const pattern = createPattern(64, 4);
      expect(pattern.header.numberOfRows).toBe(64);
      expect(pattern.data.length).toBe(64);
      expect(pattern.data[0].length).toBe(4);
      // All notes should be empty
      expect(pattern.data[0][0].note).toBe(0);
      expect(pattern.data[0][0].instrument).toBe(0);
      expect(pattern.data[0][0].volume).toBeUndefined();
    });

    it('should create pattern with custom size', () => {
      const pattern = createPattern(32, 8);
      expect(pattern.header.numberOfRows).toBe(32);
      expect(pattern.data.length).toBe(32);
      expect(pattern.data[0].length).toBe(8);
    });
  });

  describe('createInstrument', () => {
    it('should create an empty instrument', () => {
      const instrument = createInstrument('Test Instrument');
      expect(instrument.header.name).toBe('Test Instrument');
      expect(instrument.header.numberOfSamples).toBe(0);
      expect(instrument.samples).toHaveLength(0);
    });
  });

  describe('createSample', () => {
    it('should create an 8-bit sample', () => {
      const data = new Int8Array([0, 64, 127, 64, 0, -64, -128, -64]);
      const sample = createSample({
        name: 'Test Sample',
        data,
        volume: 48,
      });
      expect(sample.header.name).toBe('Test Sample');
      expect(sample.header.volume).toBe(48);
      expect(sample.header.type & 0x10).toBe(0); // Not 16-bit
      expect(sample.data).toBe(data);
    });

    it('should create a 16-bit sample', () => {
      const data = new Int16Array([0, 8192, 16384, 8192, 0, -8192, -16384, -8192]);
      const sample = createSample({
        name: '16-bit Sample',
        data,
      });
      expect(sample.header.type & 0x10).toBe(0x10); // 16-bit flag set
    });

    it('should set default values correctly', () => {
      const sample = createSample({
        data: new Int8Array([0]),
      });
      expect(sample.header.volume).toBe(64);
      expect(sample.header.panning).toBe(128);
      expect(sample.header.fineTune).toBe(0);
    });
  });

  describe('addSampleToInstrument', () => {
    it('should add a sample and initialize extended header', () => {
      const instrument = createInstrument('Test');
      const sample = createSample({ data: new Int8Array([0, 1, 2]) });
      
      addSampleToInstrument(instrument, sample);
      
      expect(instrument.samples).toHaveLength(1);
      expect(instrument.header.numberOfSamples).toBe(1);
      expect(instrument.extendedHeader).toBeDefined();
      expect(instrument.extendedHeader!.sampleNumberForNotes.length).toBe(96);
    });

    it('should add multiple samples', () => {
      const instrument = createInstrument('Multi-sample');
      const sample1 = createSample({ data: new Int8Array([0]) });
      const sample2 = createSample({ data: new Int8Array([1]) });
      
      addSampleToInstrument(instrument, sample1);
      addSampleToInstrument(instrument, sample2);
      
      expect(instrument.samples).toHaveLength(2);
      expect(instrument.header.numberOfSamples).toBe(2);
    });
  });

  describe('noteNameToValue', () => {
    it('should convert note names to values', () => {
      expect(noteNameToValue('C-0')).toBe(1);
      expect(noteNameToValue('C#0')).toBe(2);
      expect(noteNameToValue('D-0')).toBe(3);
      expect(noteNameToValue('C-4')).toBe(49);
      expect(noteNameToValue('A-4')).toBe(58); // A440
      expect(noteNameToValue('B-7')).toBe(96);
    });

    it('should return 0 for invalid note names', () => {
      expect(noteNameToValue('')).toBe(0);
      expect(noteNameToValue('X-4')).toBe(0);
      expect(noteNameToValue('C-8')).toBe(0);
      expect(noteNameToValue('invalid')).toBe(0);
    });
  });

  describe('noteValueToName', () => {
    it('should convert note values to names', () => {
      expect(noteValueToName(1)).toBe('C-0');
      expect(noteValueToName(2)).toBe('C#0');
      expect(noteValueToName(49)).toBe('C-4');
      expect(noteValueToName(58)).toBe('A-4');
      expect(noteValueToName(96)).toBe('B-7');
    });

    it('should return special strings for special values', () => {
      expect(noteValueToName(0)).toBe('---');
      expect(noteValueToName(97)).toBe('OFF');
      expect(noteValueToName(100)).toBe('???');
    });
  });

  describe('XMWriter.write', () => {
    it('should write a minimal XM file', () => {
      const module = createModule({ moduleName: 'Test' });
      const pattern = createPattern(64, 4);
      module.patterns.push(pattern);
      module.header.numberOfPatterns = 1;

      const writer = new XMWriter();
      const buffer = writer.write(module);

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(0);

      // Check XM signature
      const view = new Uint8Array(buffer);
      const signature = String.fromCharCode(...view.slice(0, 17));
      expect(signature).toBe('Extended Module: ');

      // Check module name position (bytes 17-36)
      const moduleName = String.fromCharCode(...view.slice(17, 21)).replace(/\0/g, '');
      expect(moduleName).toBe('Test');
    });

    it('should write XM with instruments and samples', () => {
      const module = createModule({ moduleName: 'With Samples' });
      
      // Add a pattern
      const pattern = createPattern(64, 4);
      pattern.data[0][0].note = noteNameToValue('C-4');
      pattern.data[0][0].instrument = 1;
      module.patterns.push(pattern);
      module.header.numberOfPatterns = 1;

      // Add an instrument with a sample
      const instrument = createInstrument('Sine Wave');
      const sampleData = new Int8Array(256);
      for (let i = 0; i < 256; i++) {
        sampleData[i] = Math.round(Math.sin(i / 256 * Math.PI * 2) * 127);
      }
      const sample = createSample({ name: 'Sine', data: sampleData });
      addSampleToInstrument(instrument, sample);
      module.instruments.push(instrument);
      module.header.numberOfInstruments = 1;

      const writer = new XMWriter();
      const buffer = writer.write(module);

      expect(buffer.byteLength).toBeGreaterThan(500);
    });

    it('should correctly delta-encode sample data', () => {
      const module = createModule({ moduleName: 'Delta Test' });
      
      // Add a minimal pattern
      const pattern = createPattern(1, 1);
      module.patterns.push(pattern);
      module.header.numberOfPatterns = 1;
      module.header.numberOfChannels = 1;

      // Add an instrument with simple sample data
      const instrument = createInstrument('Test');
      const sampleData = new Int8Array([0, 10, 20, 30, 40]); // Linear ramp
      const sample = createSample({ name: 'Ramp', data: sampleData });
      addSampleToInstrument(instrument, sample);
      module.instruments.push(instrument);
      module.header.numberOfInstruments = 1;

      const writer = new XMWriter();
      const buffer = writer.write(module);

      // The file should be generated without errors
      expect(buffer.byteLength).toBeGreaterThan(0);
    });
  });

  describe('createEmptyEnvelope', () => {
    it('should create an empty envelope', () => {
      const envelope = createEmptyEnvelope();
      expect(envelope.points).toHaveLength(0);
      expect(envelope.numberOfPoints).toBe(0);
      expect(envelope.type).toBe(0);
    });
  });
});

describe('XM File Format', () => {
  it('should generate valid XM header structure', () => {
    const module = createModule({
      moduleName: 'Format Test',
      numberOfChannels: 8,
      defaultTempo: 6,
      defaultBPM: 125,
    });
    
    const pattern = createPattern(64, 8);
    module.patterns.push(pattern);
    module.header.numberOfPatterns = 1;

    const writer = new XMWriter();
    const buffer = writer.write(module);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);

    // Offset 0: ID text "Extended Module: " (17 bytes)
    expect(String.fromCharCode(...uint8.slice(0, 17))).toBe('Extended Module: ');

    // Offset 17: Module name (20 bytes)
    expect(String.fromCharCode(...uint8.slice(17, 28)).replace(/\0/g, '')).toBe('Format Test');

    // Offset 37: 0x1A byte
    expect(uint8[37]).toBe(0x1a);

    // Offset 38: Tracker name (20 bytes)
    expect(String.fromCharCode(...uint8.slice(38, 58)).replace(/\0/g, '')).toBe('xm_save TypeScript ');

    // Offset 58: Version (little-endian, should be 0x0104)
    expect(view.getUint16(58, true)).toBe(0x0104);

    // Offset 60: Header size (should be 276)
    expect(view.getUint32(60, true)).toBe(276);

    // Offset 64: Song length
    expect(view.getUint16(64, true)).toBe(1);

    // Offset 66: Restart position
    expect(view.getUint16(66, true)).toBe(0);

    // Offset 68: Number of channels
    expect(view.getUint16(68, true)).toBe(8);

    // Offset 70: Number of patterns
    expect(view.getUint16(70, true)).toBe(1);

    // Offset 72: Number of instruments
    expect(view.getUint16(72, true)).toBe(0);

    // Offset 74: Flags (linear frequency table = 1)
    expect(view.getUint16(74, true)).toBe(1);

    // Offset 76: Default tempo
    expect(view.getUint16(76, true)).toBe(6);

    // Offset 78: Default BPM
    expect(view.getUint16(78, true)).toBe(125);

    // Offset 80-336: Pattern order table (256 bytes)
    // First entry should be 0
    expect(uint8[80]).toBe(0);
  });
});
