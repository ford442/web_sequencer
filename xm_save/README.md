# xm_save

A TypeScript library to save sample data and pattern data as an .xm (Extended Module) file.

## Installation

```bash
npm install xm_save
```

## Usage

```typescript
import {
  createModule,
  createPattern,
  createInstrument,
  createSample,
  addSampleToInstrument,
  noteNameToValue,
  XMWriter,
  saveToFile,
} from 'xm_save';

// Create a new module
const xmModule = createModule({
  moduleName: 'My Song',
  numberOfChannels: 4,
  defaultTempo: 6,
  defaultBPM: 125,
});

// Create a pattern with some notes
const pattern = createPattern(64, 4);
pattern.data[0][0].note = noteNameToValue('C-4');
pattern.data[0][0].instrument = 1;
pattern.data[4][0].note = noteNameToValue('E-4');
pattern.data[4][0].instrument = 1;

xmModule.patterns.push(pattern);
xmModule.header.numberOfPatterns = 1;
xmModule.header.songLength = 1;

// Create an instrument with a sine wave sample
const instrument = createInstrument('Sine Wave');
const sampleData = new Int8Array(256);
for (let i = 0; i < 256; i++) {
  sampleData[i] = Math.round(Math.sin(i / 256 * Math.PI * 2) * 127);
}
const sample = createSample({
  name: 'Sine',
  data: sampleData,
  volume: 64,
  loopStart: 0,
  loopLength: 256,
  loopType: 1, // Forward loop
});
addSampleToInstrument(instrument, sample);
xmModule.instruments.push(instrument);
xmModule.header.numberOfInstruments = 1;

// Save to file (Node.js)
await saveToFile(xmModule, 'output.xm');

// Or get the raw buffer for other use cases
const writer = new XMWriter();
const buffer = writer.write(xmModule);
```

## API Reference

### Module Creation

#### `createModule(options)`
Creates a new XM module with default settings.

Options:
- `moduleName`: Module name (up to 20 characters)
- `numberOfChannels`: Number of channels (default: 4)
- `defaultTempo`: Default tempo (default: 6)
- `defaultBPM`: Default BPM (default: 125)

#### `createPattern(numberOfRows, numberOfChannels)`
Creates an empty pattern.

- `numberOfRows`: Number of rows (default: 64)
- `numberOfChannels`: Number of channels (default: 4)

#### `createInstrument(name)`
Creates an empty instrument.

- `name`: Instrument name (up to 22 characters)

#### `createSample(options)`
Creates a sample from PCM data.

Options:
- `name`: Sample name (up to 22 characters)
- `data`: Sample data as `Int8Array` (8-bit) or `Int16Array` (16-bit)
- `volume`: Volume (0-64, default: 64)
- `fineTune`: Fine tune (-128 to +127, default: 0)
- `loopStart`: Loop start position
- `loopLength`: Loop length
- `loopType`: Loop type (0 = none, 1 = forward, 2 = ping-pong)
- `panning`: Panning (0-255, default: 128)
- `relativeNoteNumber`: Relative note number (-128 to +127)

#### `addSampleToInstrument(instrument, sample)`
Adds a sample to an instrument. Automatically initializes the extended header.

### Utility Functions

#### `noteNameToValue(noteName)`
Converts a note name (e.g., "C-4", "A#3") to XM note value (1-96).

#### `noteValueToName(noteValue)`
Converts XM note value to note name.

#### `saveToFile(module, filename)`
Saves an XM module to a file (Node.js only).

### XMWriter Class

#### `new XMWriter()`
Creates a new XM file writer.

#### `write(module)`
Writes an XM module to an `ArrayBuffer`.

## XM File Format

The XM (Extended Module) file format was created by Triton (later Starbreeze Studios) for FastTracker II in 1994. It supports:

- Up to 32 channels
- Up to 128 instruments
- Up to 256 patterns
- 8-bit and 16-bit samples
- Volume and panning envelopes
- Sample looping (forward and ping-pong)
- Various effects

## License

ISC
