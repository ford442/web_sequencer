import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicArrayBuffer, fetchPublicJson, MissingPublicAssetError } from '../publicAsset';
import { loadWavBuffer } from '@/hooks/audioEngine/initialization';

const html = () => new Response('<!doctype html><html><body>app</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('fetchPublicAsset', () => {
    it('turns the SPA index.html fallback into a missing-asset error, not a parse error', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(html())));
        await expect(fetchPublicJson('assets/onnx/tts.json')).rejects.toThrow(MissingPublicAssetError);
        await expect(fetchPublicJson('assets/onnx/tts.json')).rejects.toThrow(/assets\/onnx\/tts.json not found \(the server answered with an HTML page\)/);
    });

    it('catches an HTML page served as text/plain when JSON was asked for', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/plain' } }))));
        await expect(fetchPublicJson('x.json')).rejects.toThrow(MissingPublicAssetError);
    });

    it('reports a 404 with its status', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))));
        await expect(fetchPublicArrayBuffer('rubberband.wasm')).rejects.toThrow('rubberband.wasm not found (HTTP 404)');
    });
});

describe('built-in wavetable WAVs', () => {
    it('are committed at public/saw.wav and public/square.wav', () => {
        for (const file of ['saw.wav', 'square.wav']) {
            const bytes = readFileSync(join(process.cwd(), 'public', file));
            expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
            expect(bytes.subarray(8, 12).toString('ascii')).toBe('WAVE');
        }
    });

    it('load from the public root, not the gitignored public/assets/', async () => {
        const requested: string[] = [];
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            requested.push(url);
            return Promise.resolve(new Response(readFileSync(join(process.cwd(), 'public/saw.wav')), {
                status: 200,
                headers: { 'content-type': 'audio/wav' },
            }));
        }));
        const decoded = { sampleRate: 48000, length: 4, numberOfChannels: 1 } as AudioBuffer;
        const decodeAudioData = vi.fn((bytes: ArrayBuffer) => {
            expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
            return Promise.resolve(decoded);
        });
        const context = { sampleRate: 48000, decodeAudioData } as unknown as AudioContext;

        await expect(loadWavBuffer(context, 'saw.wav')).resolves.toBe(decoded);
        expect(requested).toHaveLength(1);
        expect(requested[0]).toMatch(/\/saw\.wav$/);
        expect(requested[0]).not.toContain('/assets/');
    });

    it('return null with the reason, without decoding the HTML fallback', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(html())));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const decodeAudioData = vi.fn();
        const context = { sampleRate: 48000, decodeAudioData } as unknown as AudioContext;
        await expect(loadWavBuffer(context, 'square.wav')).resolves.toBeNull();
        expect(decodeAudioData).not.toHaveBeenCalled();
        expect(String(error.mock.calls[0]?.[1])).toMatch(/square.wav not found/);
    });
});
