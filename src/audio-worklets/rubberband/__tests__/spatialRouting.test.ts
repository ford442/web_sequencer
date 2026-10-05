
import { SpatialRouter } from "../spatialRouter";

describe('SpatialRouter GC Safety', () => {
    it('processes blocks without allocating arrays', () => {
        const router = new SpatialRouter();
        const outputs = [
            [new Float32Array(128), new Float32Array(128)]
        ];

        // Track allocations
        let allocations = 0;
        const _Array = global.Array;
        const proxy = new Proxy(_Array, {
            construct(target, args) {
                allocations++;
                return new target(...args);
            }
        });
        global.Array = proxy;

        for (let i = 0; i < 1000; i++) {
            // Vowel case
            router.process(outputs, 0.5, 1.0, i, 0.8);
            // Consonant case
            router.process(outputs, 0.5, 0.0, i, 0.8);
            // Bypass case
            router.process(outputs, 0.0, 1.0, i, 0.8);
        }

        global.Array = _Array;

        expect(allocations).toBe(0);
    });
});
