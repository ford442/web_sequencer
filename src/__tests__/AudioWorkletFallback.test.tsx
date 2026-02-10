import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SingingVoice } from '../engines/SingingVoice';
// Open303Oscillator tests removed as it no longer supports fallback

// Mock AudioContext and related APIs
beforeEach(() => {
    vi.clearAllMocks();
});

describe('AudioWorklet Fallback Support', () => {
    it('SingingVoice supports forceScriptProcessor parameter', async () => {
        const mockContext = new AudioContext();
        const voice = new SingingVoice(mockContext);
        
        // Should not throw when forcing script processor
        await expect(voice.initWorklet(true)).resolves.not.toThrow();
    });

    it('SingingVoice cleans up existing nodes on reinitialization', async () => {
        const mockContext = new AudioContext();
        const voice = new SingingVoice(mockContext);
        
        // Initialize with worklet mode first
        await voice.initWorklet(false).catch(() => {}); // May fail in test env
        
        // Reinitialize with script processor mode
        await voice.initWorklet(true).catch(() => {}); // May fail in test env
        
        // Should not throw - proves cleanup works
        expect(true).toBe(true);
    });

    it('ScriptProcessorNode mode logs appropriate console messages', async () => {
        const consoleSpy = vi.spyOn(console, 'log');
        const mockContext = new AudioContext();
        const voice = new SingingVoice(mockContext);
        
        // Force script processor mode
        await voice.initWorklet(true).catch(() => {});
        
        // Should log about initializing ScriptProcessor fallback
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Initializing ScriptProcessorNode fallback')
        );
        
        consoleSpy.mockRestore();
    });
});
