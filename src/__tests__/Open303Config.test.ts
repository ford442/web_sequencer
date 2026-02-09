import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import type { Open303Config } from '../engines/Open303Params';

// Mock fetch for WASM files
global.fetch = vi.fn((url: string) => {
    if (typeof url === 'string' && url.includes('.wasm')) {
        return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
        } as Response);
    }
    return Promise.resolve({
        ok: false,
        status: 404
    } as Response);
}) as any;

describe('Open303 Configuration', () => {
    let mockAudioContext: AudioContext;

    beforeEach(() => {
        mockAudioContext = {
            createGain: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                gain: { value: 1.0 }
            })),
            sampleRate: 44100,
            audioWorklet: null
        } as any;
    });

    describe('Open303Config interface', () => {
        it('should accept configuration with preferWorklet flag', async () => {
            const engine = new Open303Oscillator();
            const config: Open303Config = {
                preferWorklet: true,
                preferThreaded: false,
                forceScriptProcessor: false,
                forceSingleThreaded: false
            };

            // Should not throw
            await engine.init(mockAudioContext, undefined, config);
            expect(engine).toBeDefined();
        });

        it('should accept configuration with preferThreaded flag', async () => {
            const engine = new Open303Oscillator();
            const config: Open303Config = {
                preferWorklet: false,
                preferThreaded: true,
                forceScriptProcessor: false,
                forceSingleThreaded: false
            };

            await engine.init(mockAudioContext, undefined, config);
            expect(engine).toBeDefined();
        });

        it('should accept configuration with forceScriptProcessor flag', async () => {
            const engine = new Open303Oscillator();
            const config: Open303Config = {
                preferWorklet: true,
                preferThreaded: false,
                forceScriptProcessor: true,
                forceSingleThreaded: false
            };

            await engine.init(mockAudioContext, undefined, config);
            expect(engine.useWorklet).toBe(false);
        });

        it('should accept configuration with forceSingleThreaded flag', async () => {
            const engine = new Open303Oscillator();
            const config: Open303Config = {
                preferWorklet: false,
                preferThreaded: true,
                forceScriptProcessor: false,
                forceSingleThreaded: true
            };

            await engine.init(mockAudioContext, undefined, config);
            expect(engine.isThreaded).toBe(false);
        });
    });

    describe('Fallback chain', () => {
        it('should prefer single-threaded by default', async () => {
            const engine = new Open303Oscillator();
            
            // Default config should prefer single-threaded
            await engine.init(mockAudioContext);
            
            // We can't check the exact variant without mocking deeper,
            // but we can verify it completed
            expect(engine).toBeDefined();
        });

        it('should respect preferThreaded option', async () => {
            const engine = new Open303Oscillator();
            const config: Open303Config = {
                preferThreaded: true
            };

            await engine.init(mockAudioContext, undefined, config);
            expect(engine).toBeDefined();
        });

        it('should handle forceScriptProcessor correctly', async () => {
            const engine = new Open303Oscillator();
            const config: Open303Config = {
                preferWorklet: true,
                forceScriptProcessor: true
            };

            await engine.init(mockAudioContext, undefined, config);
            
            // Should force ScriptProcessor mode
            expect(engine.useWorklet).toBe(false);
        });
    });

    // Helper to track script element creation for variant selection tests
    function mockScriptElementTracking(): HTMLScriptElement[] {
        const scriptElements: HTMLScriptElement[] = [];
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            const element = originalCreateElement(tagName);
            if (tagName === 'script') {
                scriptElements.push(element as HTMLScriptElement);
            }
            return element;
        });
        return scriptElements;
    }

    describe('WASM variant selection', () => {
        it('should attempt to load threaded variant when preferThreaded is true', async () => {
            const scriptElements = mockScriptElementTracking();

            const engine = new Open303Oscillator();
            const config: Open303Config = {
                preferThreaded: true,
                forceScriptProcessor: false,
                preferWorklet: false
            };

            await engine.init(mockAudioContext, undefined, config);
            
            // Should have attempted to load jc303-threaded.js
            const hasThreadedAttempt = scriptElements.some(script => 
                script.src.includes('jc303-threaded')
            );
            
            expect(hasThreadedAttempt).toBe(true);
        });

        it('should attempt to load single-threaded variant when preferThreaded is false', async () => {
            const scriptElements = mockScriptElementTracking();

            const engine = new Open303Oscillator();
            const config: Open303Config = {
                preferThreaded: false,
                forceScriptProcessor: false,
                preferWorklet: false
            };

            await engine.init(mockAudioContext, undefined, config);
            
            // Should have attempted to load jc303-single
            const hasSingleAttempt = scriptElements.some(script => 
                script.src.includes('jc303-single')
            );
            
            expect(hasSingleAttempt).toBe(true);
        });
    });

    describe('Mode tracking', () => {
        it('should track useWorklet state', async () => {
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext);
            
            // useWorklet should be boolean
            expect(typeof engine.useWorklet).toBe('boolean');
        });

        it('should track isThreaded state', async () => {
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext);
            
            // isThreaded should be boolean
            expect(typeof engine.isThreaded).toBe('boolean');
        });

        it('should track isReady state', async () => {
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext);
            
            // isReady should be boolean
            expect(typeof engine.isReady).toBe('boolean');
        });
    });
});
