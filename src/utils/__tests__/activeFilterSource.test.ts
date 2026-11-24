import { beforeEach, describe, expect, it } from 'vitest';
import {
    engineTelemetry,
    filterPairingSubsystem,
    reportFilterPairing,
    resetFilterPairingsForTests,
} from '../engineTelemetry';

const row = (host: string, requested: string) =>
    engineTelemetry.snapshot()[filterPairingSubsystem(host, requested)];

describe('reportFilterPairing (EngineHUD filter rows, #1663)', () => {
    beforeEach(() => resetFilterPairingsForTests());

    it('publishes the healthy pairing: the badge names the filter that runs', () => {
        reportFilterPairing({ host: 'Rust OSC', requested: 'C++', active: 'C++', type: 'HP' });
        expect(row('Rust OSC', 'C++')?.resolution?.backend).toBe('C++');
        expect(row('Rust OSC', 'C++')?.resolution?.reason).toBe('HP — Rust OSC samples through the C++ filter');
    });

    it('does not re-publish an unchanged pairing (called once per note)', () => {
        const p = { host: 'WASM OSC', requested: 'JS', active: 'JS', type: 'LP' };
        reportFilterPairing(p);
        const before = row('WASM OSC', 'JS')?.resolutionHistory?.length;
        reportFilterPairing(p);
        reportFilterPairing(p);
        expect(row('WASM OSC', 'JS')?.resolutionHistory?.length).toBe(before);
    });

    it('gives two parts on different sources a row each, so neither flips the other per note', () => {
        const a = { host: 'Rust OSC', requested: 'DWGS', active: 'DWGS', type: 'LP' };
        const b = { host: 'WASM OSC', requested: 'Rust', active: 'Rust', type: 'BP' };
        reportFilterPairing(a);
        reportFilterPairing(b);
        const histA = row('Rust OSC', 'DWGS')?.resolutionHistory?.length;
        const histB = row('WASM OSC', 'Rust')?.resolutionHistory?.length;
        for (let i = 0; i < 5; i++) {
            reportFilterPairing(a);
            reportFilterPairing(b);
        }
        expect(row('Rust OSC', 'DWGS')?.resolutionHistory?.length).toBe(histA);
        expect(row('WASM OSC', 'Rust')?.resolutionHistory?.length).toBe(histB);
        expect(row('Rust OSC', 'DWGS')?.resolution?.backend).toBe('DWGS');
        expect(row('WASM OSC', 'Rust')?.resolution?.backend).toBe('Rust');
    });

    it('a fallback shows as a row whose badge is not the source it is named for, with the cause', () => {
        reportFilterPairing({
            host: 'C++ OSC', requested: 'Rust', active: 'JS', type: 'BP', fallbackReason: 'no WASM SIMD',
        });
        expect(row('C++ OSC', 'Rust')?.resolution?.backend).toBe('JS');
        expect(row('C++ OSC', 'Rust')?.resolution?.reason)
            .toBe('BP — Rust filter unavailable, running on the JS filter (no WASM SIMD)');
    });

    it('publishes again when the pairing recovers', () => {
        reportFilterPairing({ host: 'DWGS', requested: 'C++', active: 'JS', type: 'LP', fallbackReason: 'down' });
        reportFilterPairing({ host: 'DWGS', requested: 'C++', active: 'C++', type: 'LP' });
        expect(row('DWGS', 'C++')?.resolution?.backend).toBe('C++');
    });

    it('says a table filter replaces the host, and a warm-up is not a failure', () => {
        reportFilterPairing({ host: 'Rust OSC', requested: 'WebGPU', active: 'JS', type: 'LP', warming: true });
        expect(row('Rust OSC', 'WebGPU')?.resolution?.reason)
            .toBe('LP — WebGPU filter warming up, the JS filter stands in (same response)');
        reportFilterPairing({ host: 'Rust OSC', requested: 'WebGPU', active: 'WebGPU', type: 'LP', replacesHost: true });
        expect(row('Rust OSC', 'WebGPU')?.resolution?.reason)
            .toBe('LP — WebGPU plays its own filtered table; Rust OSC is not heard');
    });
});
