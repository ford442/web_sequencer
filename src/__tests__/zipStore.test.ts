import { describe, it, expect } from 'vitest';
import { createZipBlob } from '../utils/zipStore';

describe('zipStore', () => {
    it('creates a valid ZIP with multiple entries', async () => {
        const encoder = new TextEncoder();
        const zip = createZipBlob([
            { path: 'stems/partA.wav', data: encoder.encode('fake-wav-a') },
            { path: 'metadata.json', data: encoder.encode('{"tempo":120}') },
        ]);

        expect(zip.type).toBe('application/zip');
        const bytes = new Uint8Array(await zip.arrayBuffer());
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
        expect(bytes[2]).toBe(0x03);
        expect(bytes[3]).toBe(0x04);
    });
});
