import { describe, it, expect } from 'vitest';
import {
    createModule, createPattern, createInstrument, createSample, addSampleToInstrument,
    XMWriter, noteNameToValue
} from '../utils/xm_save_lib/index';

describe('XM Export Debug', () => {
    it('should correctly write volume to pattern notes', () => {
        // Create a simple pattern
        const xmPat = createPattern(32, 2);
        
        // Add a note with volume
        const note = xmPat.data[0][0];
        note.note = noteNameToValue('C4'); // Should be 49
        note.instrument = 1;
        note.volume = 64; // Max volume
        
        expect(note.note).toBe(49);
        expect(note.instrument).toBe(1);
        expect(note.volume).toBe(64);
        
        console.log('Note data:', JSON.stringify(note));
    });
    
    it('should create sample with non-zero data', () => {
        const sampleRate = 44100;
        const duration = 0.1;
        const samples = new Int16Array(Math.ceil(sampleRate * duration));
        
        // Generate a sine wave
        for (let i = 0; i < samples.length; i++) {
            samples[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0x7FFF;
        }
        
        // Check that we have non-zero data
        let maxVal = 0;
        for (let i = 0; i < samples.length; i++) {
            maxVal = Math.max(maxVal, Math.abs(samples[i]));
        }
        
        console.log('Sample max value:', maxVal);
        console.log('Sample length:', samples.length);
        console.log('First 10 samples:', Array.from(samples.slice(0, 10)));
        
        expect(maxVal).toBeGreaterThan(0);
    });
    
    it('should write complete XM module', () => {
        const mod = createModule({
            moduleName: 'Test',
            numberOfChannels: 2,
            defaultTempo: 6,
            defaultBPM: 120
        });
        
        // Create sample
        const sampleRate = 44100;
        const samples = new Int16Array(4410); // 0.1s at 44.1kHz
        for (let i = 0; i < samples.length; i++) {
            samples[i] = Math.floor(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0x7FFF);
        }
        
        const sample = createSample({
            name: 'Test',
            data: samples,
            volume: 64,
        });
        sample.header.type = 0x10; // 16-bit, no loop
        
        const inst = createInstrument('Test Instrument');
        addSampleToInstrument(inst, sample);
        mod.instruments.push(inst);
        
        // Create pattern with note
        const xmPat = createPattern(32, 2);
        xmPat.data[0][0].note = 49; // C4
        xmPat.data[0][0].instrument = 1;
        xmPat.data[0][0].volume = 64;
        
        mod.patterns.push(xmPat);
        mod.header.numberOfPatterns = 1;
        mod.header.numberOfInstruments = 1;
        mod.header.songLength = 1;
        mod.header.patternOrderTable[0] = 0;
        
        // Write
        const writer = new XMWriter();
        const buffer = writer.write(mod);
        
        console.log('XM file size:', buffer.byteLength, 'bytes');
        
        // Check header
        const view = new Uint8Array(buffer);
        const header = String.fromCharCode(...view.slice(0, 17));
        
        console.log('XM Header ID:', header);
        expect(header).toBe('Extended Module: ');
        
        // Check that file has reasonable size
        expect(buffer.byteLength).toBeGreaterThan(300);
    });
});
