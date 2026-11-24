// The WebGPU filter's prewarm (#1675): bake the bank when a synth that uses the
// filter has its knobs set, and only then.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { GPU_FILTER_PREWARM_DEBOUNCE_MS, prewarmGpuFilter, useGpuFilterPrewarm } from '../useGpuFilterPrewarm';
import { setGpuFilter } from '../../engines/filterStages';
import type { WebGpuFilter } from '../../engines/WebGpuFilter';
import { kernelResonance } from '../../engines/backends/filterSource';

const ctx = { sampleRate: 48000 } as unknown as AudioContext;

function install(opts: { unavailable?: string | null } = {}) {
    const gpu = {
        unavailableReason: vi.fn(() => opts.unavailable ?? null),
        warm: vi.fn((_ctx: unknown, _shape: unknown, _spec: unknown) => Promise.resolve(true)),
    };
    setGpuFilter(gpu as unknown as WebGpuFilter);
    return gpu;
}

const synth = (extra = {}) => ({
    waveform: 'rust-saw' as const,
    filterSource: 'webgpu' as const,
    filterType: 'lp' as const,
    filterCutoff: 1200,
    filterResonance: 6,
    ...extra,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    setGpuFilter(null);
    vi.useRealTimers();
});

describe('prewarmGpuFilter', () => {
    it('bakes the bank for the synth\'s shape and the filter its knobs describe', () => {
        const gpu = install();
        expect(prewarmGpuFilter(ctx, synth({ waveform: 'wam-tri', filterType: 'hp' }))).toBe(true);
        expect(gpu.warm).toHaveBeenCalledWith(ctx, 'tri', { type: 'hp', cutoff: 1200, q: kernelResonance('hp', 6) });
    });

    it.each([
        ['another filter source', { filterSource: 'rust' as const }],
        ['no filter source (a song saved before the field)', { filterSource: undefined }],
        ['a DWGS digital wave, which the GPU cannot render', { waveform: 'dwgs-bell' as const }],
        ['a 303 part, which owns its filter', { waveform: '303-saw' as unknown as 'rust-saw' }],
    ])('does nothing for %s', (_name, extra) => {
        const gpu = install();
        expect(prewarmGpuFilter(ctx, synth(extra))).toBe(false);
        expect(gpu.warm).not.toHaveBeenCalled();
    });

    it('does nothing without a context, without a GPU filter object, or when WebGPU is unusable', () => {
        const gpu = install();
        expect(prewarmGpuFilter(null, synth())).toBe(false);
        expect(prewarmGpuFilter(undefined, synth())).toBe(false);
        setGpuFilter(null);
        expect(prewarmGpuFilter(ctx, synth())).toBe(false);
        const down = install({ unavailable: 'no adapter' });
        expect(prewarmGpuFilter(ctx, synth())).toBe(false);
        expect(gpu.warm).not.toHaveBeenCalled();
        expect(down.warm).not.toHaveBeenCalled();
    });

    it('bakes a wave the GPU can render that a DWGS part names plainly (dwgs-saw)', () => {
        const gpu = install();
        expect(prewarmGpuFilter(ctx, synth({ waveform: 'dwgs-saw' as const }))).toBe(true);
        expect(gpu.warm).toHaveBeenCalledWith(ctx, 'saw', expect.anything());
    });
});

describe('useGpuFilterPrewarm', () => {
    it('waits for a knob to settle, then bakes once', () => {
        const gpu = install();
        const { rerender } = renderHook(({ s }) => useGpuFilterPrewarm(ctx, s), { initialProps: { s: synth() } });

        // A drag: every frame a new cutoff.
        for (const cutoff of [1300, 1500, 1800, 2200]) {
            act(() => { vi.advanceTimersByTime(GPU_FILTER_PREWARM_DEBOUNCE_MS / 4); });
            rerender({ s: synth({ filterCutoff: cutoff }) });
        }
        expect(gpu.warm).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(GPU_FILTER_PREWARM_DEBOUNCE_MS); });
        expect(gpu.warm).toHaveBeenCalledTimes(1);
        expect(gpu.warm.mock.calls[0][2]).toMatchObject({ cutoff: 2200 });
    });

    it('bakes when the source is switched to the WebGPU filter, and not when it is another', () => {
        const gpu = install();
        const { rerender } = renderHook(({ s }) => useGpuFilterPrewarm(ctx, s), { initialProps: { s: synth({ filterSource: 'native' as never }) } });
        act(() => { vi.advanceTimersByTime(GPU_FILTER_PREWARM_DEBOUNCE_MS * 2); });
        expect(gpu.warm).not.toHaveBeenCalled();

        rerender({ s: synth() });
        act(() => { vi.advanceTimersByTime(GPU_FILTER_PREWARM_DEBOUNCE_MS * 2); });
        expect(gpu.warm).toHaveBeenCalledTimes(1);
    });

    it('drops a pending bake on unmount', () => {
        const gpu = install();
        const { unmount } = renderHook(() => useGpuFilterPrewarm(ctx, synth()));
        unmount();
        act(() => { vi.advanceTimersByTime(GPU_FILTER_PREWARM_DEBOUNCE_MS * 2); });
        expect(gpu.warm).not.toHaveBeenCalled();
    });

    it('does nothing before the engine has a context', () => {
        const gpu = install();
        renderHook(() => useGpuFilterPrewarm(null, synth()));
        act(() => { vi.advanceTimersByTime(GPU_FILTER_PREWARM_DEBOUNCE_MS * 2); });
        expect(gpu.warm).not.toHaveBeenCalled();
    });
});
