/**
 * The Pyodide filter's Python half (#1676), run on real CPython + NumPy + SciPy.
 *
 * The browser runs `hyphon_engine.py` in Pyodide; this test runs the same file in
 * the host's `python3` and holds `generate_filtered_table()` to the thing it
 * claims to be — the steady state of the RBJ biquad a `BiquadFilterNode` is — by
 * filtering the same periodic series in the time domain with `scipy.signal.lfilter`
 * and comparing. Skipped (with the reason) where python3 / numpy / scipy are not
 * installed; CI that vendors them runs it.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../hyphon_engine.py');

function runPython(script: string): { ok: boolean; out: string; err: string } {
    // `-I`: isolated, so nothing in the working directory shadows a module.
    const r = spawnSync('python3', ['-I', '-c', script, engine], { encoding: 'utf8', timeout: 60_000 });
    return { ok: r.status === 0, out: r.stdout ?? '', err: `${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

const available = runPython('import numpy, scipy').ok;

const PRELUDE = `
import sys, json
import numpy as np
from scipy import signal
ns = {}
exec(open(sys.argv[1]).read(), ns)
`;

describe.skipIf(!available)('hyphon_engine.py filter (real NumPy / SciPy)', () => {
    it('steady state equals lfilter of the same series, for every shape x response, to -120 dB', () => {
        const r = runPython(`${PRELUDE}
SR = 48000
ns['set_sample_rate'](SR)
worst = -999.0
for osc in ('saw', 'square', 'tri', 'sine'):
    for ft in ('lp', 'bp', 'hp'):
        for f0, cutoff, q in ((110.0, 1200.0, 0.707), (261.6256, 2000.0, 8.0), (880.0, 700.0, 3.0), (3000.0, 9000.0, 20.0)):
            cycles = max(1, int(np.ceil(2048 * f0 / SR)))
            length = int(round(SR * cycles / f0))
            base = SR * cycles / length
            # Evaluate at the table's own pitch so the comparison has no pitch error in it.
            tab = ns['generate_filtered_table'](osc, cycles, length, base, ft, cutoff, q)
            n_harm = (length // 2 - 1) // cycles
            spec = np.zeros(length // 2 + 1, dtype=complex)
            spec[cycles * np.arange(1, n_harm + 1)] = ns['_table_harmonics'](osc, n_harm)
            raw = np.fft.irfft(spec, n=length) * length / 2
            b, a = ns['_rbj_biquad'](ft, cutoff, q)
            ref = signal.lfilter(b, a, np.tile(raw, 400))[-length:]
            err = 20 * np.log10(np.max(np.abs(ref - tab)) / max(np.max(np.abs(ref)), 1e-12) + 1e-15)
            worst = max(worst, err)
print(json.dumps({'worst': worst}))
`);
        expect(r.err).toBe('');
        expect(r.ok).toBe(true);
        expect(JSON.parse(r.out.trim().split('\n').pop()!).worst).toBeLessThan(-120);
    });

    it('LP, BP and HP have the right character: a 5 kHz cutoff passes the fundamental or the top, as it should', () => {
        const r = runPython(`${PRELUDE}
SR = 48000
ns['set_sample_rate'](SR)
def level(ft, f0, cutoff):
    cycles = max(1, int(np.ceil(2048 * f0 / SR))); length = int(round(SR * cycles / f0))
    t = ns['generate_filtered_table']('sine', cycles, length, SR * cycles / length, ft, cutoff, 0.7071)
    return float(np.max(np.abs(t)))
print(json.dumps({
    'lp_low': level('lp', 200.0, 5000.0), 'lp_high': level('lp', 15000.0, 5000.0),
    'hp_low': level('hp', 200.0, 5000.0), 'hp_high': level('hp', 15000.0, 5000.0),
    'bp_in': level('bp', 5000.0, 5000.0), 'bp_out': level('bp', 200.0, 5000.0),
}))
`);
        expect(r.ok).toBe(true);
        const v = JSON.parse(r.out.trim().split('\n').pop()!) as Record<string, number>;
        expect(v.lp_low).toBeGreaterThan(0.95);
        expect(v.lp_high).toBeLessThan(0.2);
        expect(v.hp_low).toBeLessThan(0.01);
        expect(v.hp_high).toBeGreaterThan(0.9);
        expect(v.bp_in).toBeGreaterThan(0.95); // the constant 0 dB peak band pass
        expect(v.bp_out).toBeLessThan(0.1);
    });

    it('the note it renders is at the pitch asked for, and finite', () => {
        const r = runPython(`${PRELUDE}
SR = 48000
ns['set_sample_rate'](SR)
x = ns['generate_filtered_note'](440.0, 1.0, 'sine', 'lp', 8000.0, 0.7071)
print(json.dumps({'bin': int(np.argmax(np.abs(np.fft.rfft(x)))), 'n': int(len(x)), 'finite': bool(np.all(np.isfinite(x))), 'dtype': str(x.dtype)}))
`);
        expect(r.ok).toBe(true);
        expect(JSON.parse(r.out.trim().split('\n').pop()!)).toEqual({ bin: 440, n: 48000, finite: true, dtype: 'float32' });
    });

    it('refuses what it cannot render instead of returning silence', () => {
        const r = runPython(`${PRELUDE}
ns['set_sample_rate'](48000)
msgs = []
for args in (('nope', 1, 2048, 100.0, 'lp', 1000.0, 1.0), ('saw', 1, 2048, 100.0, 'xx', 1000.0, 1.0), ('saw', 0, 2048, 100.0, 'lp', 1000.0, 1.0), ('saw', 1100, 2048, 100.0, 'lp', 1000.0, 1.0)):
    try:
        ns['generate_filtered_table'](*args); msgs.append('no error')
    except ValueError as e:
        msgs.append(str(e))
print(json.dumps(msgs))
`);
        expect(r.ok).toBe(true);
        const msgs = JSON.parse(r.out.trim().split('\n').pop()!) as string[];
        expect(msgs).toHaveLength(4);
        expect(msgs.every((m) => m !== 'no error')).toBe(true);
    });

    it('clamps an absurd Q and cutoff rather than blowing up', () => {
        const r = runPython(`${PRELUDE}
ns['set_sample_rate'](48000)
t = ns['generate_filtered_table']('saw', 1, 2048, 23.4, 'bp', 1e9, 1e9)
u = ns['generate_filtered_table']('saw', 1, 2048, 23.4, 'lp', -5.0, 0.0)
print(json.dumps({'a': bool(np.all(np.isfinite(t))), 'b': bool(np.all(np.isfinite(u)))}))
`);
        expect(r.ok).toBe(true);
        expect(JSON.parse(r.out.trim().split('\n').pop()!)).toEqual({ a: true, b: true });
    });

    it('is the file the browser loads: bootstrap imports it raw', () => {
        expect(fs.readFileSync(path.resolve(path.dirname(engine), 'bootstrap.ts'), 'utf8')).toContain("./hyphon_engine.py?raw");
    });
});
