import { beforeEach, describe, expect, it } from 'vitest';
import {
    engineTelemetry,
    logFilterSourceFallback,
    reportActiveFilterSource,
    resetActiveFilterSourceForTests,
} from '../engineTelemetry';

describe('reportActiveFilterSource', () => {
    beforeEach(() => resetActiveFilterSourceForTests());

    it('publishes the healthy filter source to the HUD "filter" row', () => {
        reportActiveFilterSource('Rust');
        expect(engineTelemetry.snapshot().filter?.resolution?.backend).toBe('Rust');
        reportActiveFilterSource('JS');
        expect(engineTelemetry.snapshot().filter?.resolution?.backend).toBe('JS');
    });

    it('does not re-publish an unchanged source (called once per note)', () => {
        reportActiveFilterSource('JS');
        const before = engineTelemetry.snapshot().filter?.resolutionHistory?.length;
        reportActiveFilterSource('JS');
        expect(engineTelemetry.snapshot().filter?.resolutionHistory?.length).toBe(before);
    });

    it('keeps the fallback reason when the JS filter is the result of a fallback', () => {
        logFilterSourceFallback('Rust', 'JS', 'rust is down', 'filter-source:rust');
        reportActiveFilterSource('JS');
        expect(engineTelemetry.snapshot().filter?.resolution?.reason).toContain('rust is down');
    });
});
