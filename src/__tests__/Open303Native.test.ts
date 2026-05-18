import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioDSP, Open303Native, Open303ParamId, hasOpen303Native } from '../engines/AudioDSP';

describe('Open303 Native API (hyphon_native integration)', () => {
    let mockMalloc: ReturnType<typeof vi.fn>;
    let mockFree: ReturnType<typeof vi.fn>;
    let heapBuffer: ArrayBuffer;
    let heapF32: Float32Array;
    let heap16: Int16Array;

    // Mocks for the Open303 C API exposed through window.Module (embind)
    let open303Create: ReturnType<typeof vi.fn>;
    let open303Destroy: ReturnType<typeof vi.fn>;
    let open303Init: ReturnType<typeof vi.fn>;
    let open303NoteOn: ReturnType<typeof vi.fn>;
    let open303NoteOff: ReturnType<typeof vi.fn>;
    let open303AllNotesOff: ReturnType<typeof vi.fn>;
    let open303SetParam: ReturnType<typeof vi.fn>;
    let open303Process: ReturnType<typeof vi.fn>;

    let nextHandle = 1;

    beforeEach(() => {
        nextHandle = 1;
        mockMalloc = vi.fn((_size: number) => 1024);
        mockFree   = vi.fn();

        heapBuffer = new ArrayBuffer(64 * 1024);
        heapF32    = new Float32Array(heapBuffer);
        heap16     = new Int16Array(heapBuffer);

        open303Create      = vi.fn(() => nextHandle++);
        open303Destroy     = vi.fn();
        open303Init        = vi.fn(() => 1);
        open303NoteOn      = vi.fn();
        open303NoteOff     = vi.fn();
        open303AllNotesOff = vi.fn();
        open303SetParam    = vi.fn();
        open303Process     = vi.fn();

        globalThis.window = {
            AudioDSP: {
                applyGain:        vi.fn(),
                mixBuffers:       vi.fn(),
                findPeak:         vi.fn(() => 0),
                deinterleaveStereo: vi.fn(),
                interleaveStereo: vi.fn(),
                floatToInt16:     vi.fn(),
                applyStereoWidth: vi.fn(),
                getNumThreads:    vi.fn(() => 4),
                setNumThreads:    vi.fn(),
                open303_create:        open303Create,
                open303_destroy:       open303Destroy,
                open303_init:          open303Init,
                open303_note_on:       open303NoteOn,
                open303_note_off:      open303NoteOff,
                open303_all_notes_off: open303AllNotesOff,
                open303_set_param:     open303SetParam,
                open303_process:       open303Process,
            },
            Module: {
                HEAPF32: heapF32,
                HEAP16:  heap16,
                _malloc: mockMalloc,
                _free:   mockFree,
                open303_create:        open303Create,
                open303_destroy:       open303Destroy,
                open303_init:          open303Init,
                open303_note_on:       open303NoteOn,
                open303_note_off:      open303NoteOff,
                open303_all_notes_off: open303AllNotesOff,
                open303_set_param:     open303SetParam,
                open303_process:       open303Process,
            },
        } as unknown as Window & typeof globalThis.window;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ── hasOpen303Native ────────────────────────────────────────────────────

    describe('hasOpen303Native()', () => {
        it('returns true when window.Module.open303_create is a function', () => {
            expect(hasOpen303Native()).toBe(true);
        });

        it('returns false when window.Module is absent', () => {
            globalThis.window = {} as any;
            expect(hasOpen303Native()).toBe(false);
        });

        it('returns false when open303_create is not a function', () => {
            (globalThis.window as any).Module.open303_create = undefined;
            expect(hasOpen303Native()).toBe(false);
        });
    });

    // ── Open303Native class ─────────────────────────────────────────────────

    describe('Open303Native', () => {
        it('creates an instance via open303_create and initialises it', () => {
            const inst = new Open303Native(44100, 128);

            expect(inst.isAvailable).toBe(true);
            expect(open303Create).toHaveBeenCalledOnce();
            expect(open303Init).toHaveBeenCalledWith(1, 44100, 128);
        });

        it('reports isAvailable=false when Module is absent', () => {
            globalThis.window = {} as any;
            const inst = new Open303Native(44100);
            expect(inst.isAvailable).toBe(false);
        });

        it('calls open303_note_on with handle and midi/velocity', () => {
            const inst = new Open303Native(44100);
            inst.noteOn(60, 100);
            expect(open303NoteOn).toHaveBeenCalledWith(1, 60, 100);
        });

        it('calls open303_note_off with handle and midiNote', () => {
            const inst = new Open303Native(44100);
            inst.noteOff(60);
            expect(open303NoteOff).toHaveBeenCalledWith(1, 60);
        });

        it('calls open303_all_notes_off with handle', () => {
            const inst = new Open303Native(44100);
            inst.allNotesOff();
            expect(open303AllNotesOff).toHaveBeenCalledWith(1);
        });

        it('calls open303_set_param with handle, paramId, and value', () => {
            const inst = new Open303Native(44100);
            inst.setParam(Open303ParamId.CUTOFF, 0.5);
            expect(open303SetParam).toHaveBeenCalledWith(1, Open303ParamId.CUTOFF, 0.5);
        });

        it('calls open303_process with handle, outputPtr, and numFrames', () => {
            const inst = new Open303Native(44100);
            inst.process(2048, 128);
            expect(open303Process).toHaveBeenCalledWith(1, 2048, 128);
        });

        it('disposes by calling open303_destroy with handle', () => {
            const inst = new Open303Native(44100);
            inst.dispose();
            expect(open303Destroy).toHaveBeenCalledWith(1);
        });

        it('does nothing on note/param calls when isAvailable is false', () => {
            globalThis.window = {} as any;
            const inst = new Open303Native(44100);
            expect(inst.isAvailable).toBe(false);

            // These should not throw
            inst.noteOn(60, 100);
            inst.noteOff(60);
            inst.allNotesOff();
            inst.setParam(Open303ParamId.RESONANCE, 0.9);
            inst.process(0, 128);
            inst.dispose();

            expect(open303NoteOn).not.toHaveBeenCalled();
        });

        it('multiple instances have independent handles', () => {
            const a = new Open303Native(44100);
            const b = new Open303Native(44100);

            expect(a.isAvailable).toBe(true);
            expect(b.isAvailable).toBe(true);
            expect(open303Create).toHaveBeenCalledTimes(2);

            a.noteOn(60, 100);
            b.noteOn(72, 80);

            expect(open303NoteOn).toHaveBeenNthCalledWith(1, 1, 60, 100);
            expect(open303NoteOn).toHaveBeenNthCalledWith(2, 2, 72, 80);
        });
    });

    // ── Open303ParamId constants ────────────────────────────────────────────

    describe('Open303ParamId', () => {
        it('has the correct numeric values matching the C++ enum', () => {
            expect(Open303ParamId.WAVEFORM).toBe(0);
            expect(Open303ParamId.TUNING).toBe(1);
            expect(Open303ParamId.CUTOFF).toBe(2);
            expect(Open303ParamId.RESONANCE).toBe(3);
            expect(Open303ParamId.ENV_MOD).toBe(4);
            expect(Open303ParamId.DECAY).toBe(5);
            expect(Open303ParamId.ACCENT).toBe(6);
            expect(Open303ParamId.VOLUME).toBe(7);
            expect(Open303ParamId.FILTER_MODE).toBe(8);
            expect(Open303ParamId.NORMAL_DECAY).toBe(9);
            expect(Open303ParamId.ACCENT_DECAY).toBe(10);
            expect(Open303ParamId.SLIDE_TIME).toBe(11);
            expect(Open303ParamId.SOFT_ATTACK).toBe(12);
            expect(Open303ParamId.SQUARE_DRIVER).toBe(13);
        });
    });

    // ── AudioDSP still works alongside Open303 additions ───────────────────

    describe('AudioDSP is unaffected', () => {
        it('isAvailable returns true', () => {
            const dsp = new AudioDSP();
            expect(dsp.isAvailable()).toBe(true);
        });

        it('getNumThreads delegates to module', () => {
            const dsp = new AudioDSP();
            expect(dsp.getNumThreads()).toBe(4);
        });
    });
});
