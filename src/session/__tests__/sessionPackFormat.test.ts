import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { TRACK_KEYS } from '../../constants';
import type { PartSequence } from '../../types';
import { createEmptyTrackStorage } from '../../utils/trackStorageUtils';
import { createDefaultSessionDocument } from '../defaults';
import { SESSION_PACKS, getSessionPack } from '../packs';
import { exportSessionPack, pickPackSynthSettings, slugifyPackId, stringifyPackFile } from '../pack/export';
import {
  PACK_LIMITS,
  SESSION_PACK_FORMAT,
  SESSION_PACK_FORMAT_VERSION,
  type SessionPack,
  type SessionPackFile,
} from '../pack/format';
import { migrateSessionPack } from '../pack/migrate';
import { PACK_WAVEFORMS } from '../pack/instruments';
import { buildSessionPackSchema } from '../pack/schema';
import { validate_session_pack } from '../pack/generated/packValidator.js';
import { parseSessionPackText } from '../pack/validate';

type Json = Record<string, unknown>;

/** Reads `a.b.0.c` from parsed JSON (numbers index arrays). */
function get(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => (cur as Record<string, unknown>)[key], root);
}
/** Writes `value` at `a.b.0.c`; the damage each test does to an otherwise valid pack. */
function set(root: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() ?? '';
  const parent = keys.length === 0 ? root : get(root, keys.join('.'));
  (parent as Record<string, unknown>)[last] = value;
}

const packInput = (pack: SessionPack) => ({
  name: pack.name,
  description: pack.description,
  session: pack.session,
  trackStorage: pack.trackStorage,
  synthA: pack.instruments?.synthA,
  synthB: pack.instruments?.synthB,
});

function exportBuiltIn(id: string): { text: string; file: SessionPackFile } {
  const pack = getSessionPack(id);
  if (!pack) throw new Error(`no built-in pack ${id}`);
  const result = exportSessionPack(packInput(pack));
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '));
  return { text: result.text, file: result.file };
}

/** A parsed pack file to damage on purpose. */
const fixture = (): Json => JSON.parse(exportBuiltIn('minimal-drum-lab').text) as Json;
const asText = (file: Json) => JSON.stringify(file);

function reject(file: Json | string): { code: string; path: string; message: string } {
  const result = parseSessionPackText(typeof file === 'string' ? file : asText(file));
  expect(result.ok, 'expected the pack to be refused').toBe(false);
  if (result.ok) throw new Error('unreachable');
  return result.errors[0];
}

describe('session pack round trip', () => {
  it.each(SESSION_PACKS.map((p) => p.id))('%s survives export → import unchanged', (id) => {
    const pack = getSessionPack(id)!;
    const { text } = exportBuiltIn(id);
    const parsed = parseSessionPackText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // session schema, scenes and clip links
    expect(parsed.pack.session).toEqual(pack.session);
    // pattern slots, notes, sampler banks — every slot, including the empty ones
    expect(parsed.pack.trackStorage).toEqual(pack.trackStorage);
    // supported instrument parameters
    if (pack.instruments?.synthA) expect(parsed.pack.instruments?.synthA).toEqual(pack.instruments.synthA);
    if (pack.instruments?.synthB) expect(parsed.pack.instruments?.synthB).toEqual(pack.instruments.synthB);
    expect(parsed.pack.name).toBe(pack.name);
    expect(parsed.pack.formatVersion).toBe(SESSION_PACK_FORMAT_VERSION);
  });

  it('exports deterministically', () => {
    expect(exportBuiltIn('acid-live-set').text).toBe(exportBuiltIn('acid-live-set').text);
  });

  it('keeps a live session’s slot links, custom scenes and launch settings', () => {
    const storage = createEmptyTrackStorage();
    const bank = (note: string): PartSequence[] =>
      Array.from({ length: 8 }, (_, i) => ({ steps: Array.from({ length: 32 }, (_, s) => (i === 0 && s === 0 ? { note, velocity: 0.8, reverse: true } : null)) }));
    const seq = (note: string, extra = {}): PartSequence => ({
      steps: Array.from({ length: 16 }, (_, s) => (s % 4 === 0 ? { note, velocity: 0.7, probability: 0.5, chord: ['E4'], ...extra } : null)),
      automation: { filterCutoff: [0.1, null, 0.9] },
    });
    storage.partA[3] = seq('C4', { slide: true, slideType: 'exponential' });
    storage.kick[7] = seq('C2');
    storage.sampler[5] = bank('G3');

    const session = createDefaultSessionDocument();
    // Clips deliberately point away from their own row: slot links must survive.
    Object.assign(session.columns.partA.clips[0], { slotIndex: 3, name: 'Chords', empty: false, launchMode: 'toggle', followAction: 'repeat', followRepeatN: 4 });
    Object.assign(session.columns.kick.clips[2], { slotIndex: 7, name: 'Pulse', empty: false });
    Object.assign(session.columns.sampler.clips[1], { slotIndex: 5, name: 'Vox', empty: false, launchMode: 'gate' });
    session.quantization = '2bars';
    session.scenes[0] = { id: 's:0', name: 'Mixed', clipIds: { partA: session.columns.partA.clips[0].id, kick: session.columns.kick.clips[2].id, sampler: null } };

    const exported = exportSessionPack({ name: 'My Live Set', session, trackStorage: storage, synthA: { waveform: 'sawtooth', filterCutoff: 1800, volume: 0.6 } });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.filename).toBe('my-live-set.hyphonpack.json');

    const back = parseSessionPackText(exported.text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.pack.session).toEqual(session);
    expect(back.pack.trackStorage).toEqual(storage);
    expect(back.pack.instruments).toEqual({ synthA: { waveform: 'sawtooth', filterCutoff: 1800, volume: 0.6 } });
    expect(back.pack.id).toBe('my-live-set');
  });

  it('writes a clip without a pattern behind it as empty instead of a dangling reference', () => {
    const session = createDefaultSessionDocument();
    session.columns.kick.clips[0].empty = false; // no pattern in slot 0
    const exported = exportSessionPack({ name: 'Mended', session, trackStorage: createEmptyTrackStorage() });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.file.session.columns.kick.clips[0].empty).toBe(true);
    expect(exported.warnings.join(' ')).toMatch(/1 clip pointed at an empty pattern slot/);
    expect(session.columns.kick.clips[0].empty).toBe(false); // the live document is not touched
  });

  it('refuses to export what it could not import again', () => {
    const storage = createEmptyTrackStorage();
    storage.kick[0] = { steps: [{ note: 'C2', velocity: Number.NaN }] }; // JSON turns NaN into null
    const session = createDefaultSessionDocument();
    session.columns.kick.clips[0].empty = false;
    const exported = exportSessionPack({ name: 'Broken', session, trackStorage: storage });
    expect(exported.ok).toBe(false);
    if (exported.ok) return;
    expect(exported.errors[0].code).toBe('export');
    expect(exported.errors[0].message).toMatch(/cannot be exported/);
    expect(exported.errors[0].path).toBe('trackStorage.kick[0].steps[0].velocity');
  });
});

describe('session pack validation', () => {
  it('accepts a pack with trailing empty slots and missing tracks omitted', () => {
    const file = fixture();
    expect(Object.keys(get(file, 'trackStorage') as object)).not.toContain('sampler');
    expect(parseSessionPackText(asText(file)).ok).toBe(true);
  });

  it('accepts a UTF-8 byte-order mark', () => {
    expect(parseSessionPackText(`\uFEFF${asText(fixture())}`).ok).toBe(true);
  });

  it('refuses text that is not JSON', () => {
    const issue = reject('{ "format": ');
    expect(issue.code).toBe('invalid-json');
    expect(issue.message).toMatch(/not valid JSON/);
  });

  it('refuses a file that is not a pack, and says what it looks like', () => {
    expect(reject('[]').code).toBe('not-a-pack');
    expect(reject('{}').message).toMatch(/"format" must be "hyphon-session-pack"/);
    expect(reject({ pattern: {}, params: {} }).message).toMatch(/song file/);
    expect(reject({ meta: {}, tracks: {} }).message).toMatch(/AI song/);
  });

  it('refuses unknown format versions with a version-specific message', () => {
    const newer = reject({ ...fixture(), formatVersion: SESSION_PACK_FORMAT_VERSION + 1 });
    expect(newer.code).toBe('unsupported-version');
    expect(newer.message).toMatch(/format version 2; this build reads up to version 1/);
    expect(reject({ ...fixture(), formatVersion: 0 }).code).toBe('unsupported-version');
    expect(reject({ ...fixture(), formatVersion: '1' }).code).toBe('unsupported-version');
    expect(reject({ ...fixture(), formatVersion: 1.5 }).code).toBe('unsupported-version');
  });

  it('refuses oversized input before parsing it', () => {
    const text = asText(fixture());
    const small = parseSessionPackText(text, 100);
    expect(small.ok).toBe(false);
    if (small.ok) return;
    expect(small.errors[0].code).toBe('too-large');
    // Multi-byte text is measured in bytes, not characters.
    const emoji = `"${'🎹'.repeat(30)}"`; // 62 chars, 122 bytes
    expect(parseSessionPackText(emoji, 100).ok).toBe(false);
    expect(parseSessionPackText(text, PACK_LIMITS.maxBytes).ok).toBe(true);
  });

  describe('malformed patterns', () => {
    it.each([
      ['velocity above 1', (f: Json) => { set(f, 'trackStorage.kick.0.steps.0.velocity', 7); }, /trackStorage\.kick\[0\]\.steps\[0\]\.velocity: 7 is out of range; it must be at most 1/],
      ['note that is not a name', (f: Json) => { set(f, 'trackStorage.kick.0.steps.0.note', 'H4'); }, /not a note name/],
      ['note above the MIDI range', (f: Json) => { set(f, 'trackStorage.kick.0.steps.0.note', 'G#9'); }, /outside the playable range/],
      ['chord note that is not a name', (f: Json) => { set(f, 'trackStorage.kick.0.steps.0.chord', ['C4', 'nope']); }, /chord\[1\]|not a note name/],
      ['no steps', (f: Json) => { set(f, 'trackStorage.kick.0.steps', []); }, /needs at least 1 item/],
      ['too many steps', (f: Json) => { set(f, 'trackStorage.kick.0.steps', Array<unknown>(PACK_LIMITS.maxSteps + 1).fill(null)); }, /too many items/],
      ['a step that is not an object', (f: Json) => { set(f, 'trackStorage.kick.0.steps.0', 'C4'); }, /must be object or null/],
      ['a pattern that is not an object', (f: Json) => { set(f, 'trackStorage.kick.0', 5); }, /must be object or null/],
      ['a sampler slot that is not a list of banks', (f: Json) => { set(f, 'trackStorage.sampler', [get(f, 'trackStorage.kick.0')]); }, /must be array or null/],
      ['more sampler banks than exist', (f: Json) => { set(f, 'trackStorage.sampler', [Array<unknown>(PACK_LIMITS.maxSamplerBanks + 1).fill(get(f, 'trackStorage.kick.0'))]); }, /too many items/],
      ['more slots than a track has', (f: Json) => { set(f, 'trackStorage.kick', Array<unknown>(PACK_LIMITS.maxSlotsPerTrack + 1).fill(null)); }, /too many items/],
      ['a non-finite number as a string', (f: Json) => { set(f, 'trackStorage.kick.0.steps.0.timbre', 'loud'); }, /must be number/],
      ['an enormous number', (f: Json) => { set(f, 'trackStorage.kick.0.steps.0.timbre', 1e300); }, /out of range/],
      ['an automation lane with a text value', (f: Json) => { set(f, 'trackStorage.kick.0.automation', { filterCutoff: ['x'] }); }, /must be number or null/],
    ])('refuses %s', (_label, damage, message) => {
      const file = fixture();
      damage(file);
      expect(reject(file).message).toMatch(message);
    });

    it('names the path of the first problem', () => {
      const file = fixture();
      const step = (get(file, 'trackStorage.snare.1.steps') as unknown[]).findIndex(Boolean);
      set(file, `trackStorage.snare.1.steps.${step}.velocity`, -1);
      expect(reject(file).path).toBe(`trackStorage.snare[1].steps[${step}].velocity`);
    });
  });

  describe('dangling references', () => {
    it('refuses a non-empty clip with no pattern behind it', () => {
      const file = fixture();
      set(file, 'trackStorage.kick.0', null);
      const issue = reject(file);
      expect(issue.code).toBe('reference');
      expect(issue.message).toMatch(/not empty but trackStorage\.kick\[0\] has no pattern/);
    });

    it('refuses a clip slot beyond the last slot', () => {
      const file = fixture();
      set(file, 'session.columns.kick.clips.0.slotIndex', PACK_LIMITS.maxSlotsPerTrack);
      expect(reject(file).message).toMatch(/slotIndex: .* out of range/);
    });

    it('refuses a scene that names a clip that does not exist', () => {
      const file = fixture();
      set(file, 'session.scenes.0.clipIds.kick', 'c:kick:99');
      const issue = reject(file);
      expect(issue.code).toBe('reference');
      expect(issue.path).toBe('session.scenes[0].clipIds.kick');
      expect(issue.message).toMatch(/"c:kick:99", which does not exist/);
    });

    it('refuses a scene that names another track’s clip', () => {
      const file = fixture();
      set(file, 'session.scenes.0.clipIds.kick', get(file, 'session.columns.snare.clips.0.id'));
      expect(reject(file).message).toMatch(/belongs to SNARE, not KICK/);
    });

    it('refuses duplicate clip ids and duplicate scene ids', () => {
      const dupClip = fixture();
      set(dupClip, 'session.columns.snare.clips.0.id', get(dupClip, 'session.columns.kick.clips.0.id'));
      expect(reject(dupClip).code).toBe('duplicate-id');

      const dupScene = fixture();
      set(dupScene, 'session.scenes.1.id', get(dupScene, 'session.scenes.0.id'));
      expect(reject(dupScene).code).toBe('duplicate-id');
    });

    it('refuses columns of different lengths and more scenes than rows', () => {
      const ragged = fixture();
      (get(ragged, 'session.columns.kick.clips') as unknown[]).pop();
      expect(reject(ragged).code).toBe('inconsistent');

      const extra = fixture();
      const scenes = get(extra, 'session.scenes') as unknown[];
      for (const n of [99, 100, 101]) scenes.push({ id: `s:${n}`, name: `Extra ${n}`, clipIds: {} });
      expect(reject(extra).message).toMatch(/scenes but the session only has 8 rows/);
    });

    it('refuses a column filed under the wrong track', () => {
      const file = fixture();
      set(file, 'session.columns.kick.track', 'snare');
      expect(reject(file).message).toMatch(/column sits under "kick"/);
    });
  });

  describe('instruments', () => {
    const withSynth = (settings: Json) => ({ ...fixture(), instruments: { synthA: settings } });

    it.each([
      ['an unknown waveform', { waveform: 'evil-saw' }, /not allowed; use one of/],
      ['a cutoff below the audible range', { filterCutoff: 3 }, /out of range; it must be at least 20/],
      ['a negative resonance', { filterResonance: -1 }, /out of range/],
      ['a volume that is text', { volume: 'max' }, /must be number/],
      ['a macro knob above 1', { macro: { harmonics: 1.5 } }, /out of range; it must be at most 1/],
      ['more macro voices than exist', { macro: { polyphony: 9 } }, /out of range/],
      ['a fractional macro voice count', { macro: { polyphony: 2.5 } }, /must be integer/],
      ['an unknown 303 voice', { model303: 'my-voice' }, /not allowed/],
      ['a field the format does not carry', { model303Extra: {} }, /unknown field "model303Extra"/],
      ['a URL', { sampleUrl: 'https://example.com/a.wav' }, /unknown field "sampleUrl".*no URLs/],
    ])('refuses %s', (_label, settings, message) => {
      expect(reject(withSynth(settings)).message).toMatch(message);
    });

    it('refuses instruments for parts the format does not have', () => {
      expect(reject({ ...fixture(), instruments: { bass2: {} } }).message).toMatch(/unknown field "bass2"/);
    });

    it('accepts every waveform the app can play', () => {
      for (const waveform of PACK_WAVEFORMS) {
        expect(parseSessionPackText(asText(withSynth({ waveform }))).ok, waveform).toBe(true);
      }
    });
  });

  describe('data only: nothing executable, nothing fetched', () => {
    it('refuses unknown fields anywhere, URLs included', () => {
      const topLevel = { ...fixture(), icon: 'https://example.com/i.png' };
      expect(reject(topLevel).message).toMatch(/unknown field "icon"/);

      const inNote = fixture();
      set(inNote, 'trackStorage.kick.0.steps.0.sampleUrl', 'https://example.com/kick.wav');
      expect(reject(inNote).message).toMatch(/unknown field "sampleUrl"/);

      const inClip = fixture();
      set(inClip, 'session.columns.kick.clips.0.onLaunch', 'alert(1)');
      expect(reject(inClip).message).toMatch(/unknown field "onLaunch"/);
    });

    it('refuses prototype-polluting keys', () => {
      const text = asText(fixture()).replace('"steps":', '"__proto__":{"polluted":true},"steps":');
      expect(reject(text).message).toMatch(/unknown field "__proto__"/);

      const lane = asText(fixture()).replace(/"steps":\[/, '"automation":{"__proto__":[1]},"steps":[');
      expect(parseSessionPackText(lane).ok).toBe(false);
      expect(({} as Json).polluted).toBeUndefined();
    });

    it('refuses control and direction-override characters in names', () => {
      expect(reject({ ...fixture(), name: 'evil‮txt.exe' }).message).toMatch(/control or text-direction/);
      expect(reject({ ...fixture(), description: 'line\u0000break' }).message).toMatch(/control or text-direction/);
    });

    describe('hostile nesting', () => {
      // JSON.parse accepts nesting that structuredClone and JSON.stringify overflow the stack on, so the
      // depth cap has to refuse it first. 100k levels is ~200 KB: well inside the size limit.
      const LEVELS = 100_000;
      const deepArray = '['.repeat(LEVELS) + ']'.repeat(LEVELS);
      const deepObject = '{"a":'.repeat(LEVELS) + '1' + '}'.repeat(LEVELS);
      const withDeep = (field: string, deep: string) =>
        asText(fixture()).replace(/^\{/, `{"${field}":${deep},`);

      it.each([
        ['an unknown field holding a deep array', withDeep('x', deepArray)],
        ['an unknown field holding a deep object', withDeep('x', deepObject)],
        // Replaces the value (a prepended second "name" key would lose to the original: last key wins).
        ['a known field holding a deep array (the error formatter would stringify it)', asText(fixture()).replace(/"name":"[^"]*"/, `"name":${deepArray}`)],
        ['a deep array where a note name belongs', asText(fixture()).replace(/"note":"[^"]*"/, `"note":${deepArray}`)],
      ])('refuses %s with a sentence instead of throwing', (_label, text) => {
        let issue: { code: string; path: string; message: string } | undefined;
        expect(() => { issue = reject(text); }).not.toThrow();
        expect(issue?.code).toBe('schema');
        expect(issue?.message).toMatch(new RegExp(`more than ${PACK_LIMITS.maxDepth} levels deep`));
        expect(issue?.message).toMatch(/Export the pack again from Hyphon/);
      });

      it('draws the line at maxDepth: that deep still reaches the schema, one deeper does not', () => {
        // The root is level 1, so `n` nested arrays under an unknown field reach level n + 1.
        const nested = (n: number) => '['.repeat(n) + ']'.repeat(n);
        const atLimit = reject(withDeep('x', nested(PACK_LIMITS.maxDepth - 1)));
        expect(atLimit.message).toMatch(/unknown field "x"/);
        const over = reject(withDeep('x', nested(PACK_LIMITS.maxDepth)));
        expect(over.message).toMatch(/levels deep/);
      });

      it('leaves real packs far from the cap', () => {
        // Depth of the real files is 7; if a format change ever needs more than half the cap, raise the cap on purpose.
        const depthOf = (value: unknown): number => {
          let max = 0;
          const pending: Array<[unknown, number]> = [[value, 1]];
          while (pending.length > 0) {
            const [node, depth] = pending.pop() as [unknown, number];
            if (typeof node !== 'object' || node === null) continue;
            max = Math.max(max, depth);
            for (const child of Object.values(node)) pending.push([child, depth + 1]);
          }
          return max;
        };
        for (const pack of SESSION_PACKS) {
          const { file } = exportBuiltIn(pack.id);
          expect(depthOf(file), pack.id).toBeLessThanOrEqual(PACK_LIMITS.maxDepth / 2);
        }
      });
    });

    it('says a non-finite number is not finite, instead of "got null"', () => {
      // `1e999` is valid JSON text and parses to Infinity; JSON.stringify(Infinity) is "null".
      const text = asText(fixture()).replace(/"velocity":[0-9.]+/, '"velocity":1e999');
      const issue = reject(text);
      expect(issue.message).toMatch(/velocity: must be a finite number, got Infinity\./);
      expect(issue.message).not.toMatch(/null/);
    });

    it('requires a slug id', () => {
      expect(reject({ ...fixture(), id: 'Has Spaces' }).message).toMatch(/lowercase slug/);
      expect(reject({ ...fixture(), id: '' }).message).toMatch(/must not be empty/);
      expect(reject({ ...fixture(), id: 'a'.repeat(PACK_LIMITS.maxIdLength + 1) }).message).toMatch(/too long/);
    });

    it('never calls Function or eval while validating', () => {
      const code = readFileSync(resolve(__dirname, '../pack/generated/packValidator.js'), 'utf8');
      expect(code).not.toMatch(/\bnew Function\b|\beval\(|\brequire\(|^\s*import\s/m);
    });
  });

  it('reports a pack with nothing to launch as a warning, not an error', () => {
    const file = fixture();
    for (const track of TRACK_KEYS) {
      for (const clip of get(file, `session.columns.${track}.clips`) as Array<{ empty: boolean }>) clip.empty = true;
    }
    const result = parseSessionPackText(asText(file));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings[0].message).toMatch(/no clips to launch/);
  });

  it('reports at most one structural issue but every reference issue up to the cap', () => {
    const file = fixture();
    set(file, 'session.scenes.0.clipIds.kick', 'c:kick:98');
    set(file, 'session.scenes.1.clipIds.snare', 'c:snare:98');
    const result = parseSessionPackText(asText(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });
});

describe('session pack migrations', () => {
  const v1 = { format: SESSION_PACK_FORMAT, formatVersion: 1, name: 'old' };

  it('is a no-op for the current version and does not touch the input', () => {
    const input = Object.freeze({ format: SESSION_PACK_FORMAT, formatVersion: SESSION_PACK_FORMAT_VERSION, id: 'x' });
    const out = migrateSessionPack(input);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fromVersion).toBe(SESSION_PACK_FORMAT_VERSION);
      expect(out.raw).toEqual(input);
      expect(out.raw).not.toBe(input);
    }
  });

  it('runs each step in order, stamps the version, and leaves the input unmodified', () => {
    const calls: number[] = [];
    const migrations = {
      1: (raw: Json) => { calls.push(1); return { ...raw, renamedInV2: raw.name }; },
      2: (raw: Json) => { calls.push(2); const { renamedInV2, ...rest } = raw; return { ...rest, id: renamedInV2 }; },
    };
    const input = Object.freeze({ ...v1, nested: { keep: true } });
    const out = migrateSessionPack(input, { current: 3, migrations });
    expect(calls).toEqual([1, 2]);
    expect(out).toEqual({ ok: true, fromVersion: 1, raw: { format: SESSION_PACK_FORMAT, formatVersion: 3, name: 'old', id: 'old', nested: { keep: true } } });
    expect(input.formatVersion).toBe(1);
  });

  it('refuses a version with no migration path, and a migration that throws', () => {
    const gap = migrateSessionPack(v1, { current: 3, migrations: { 2: (r: Json) => r } });
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.error.message).toMatch(/No migration from pack format version 1 to 2/);

    const boom = migrateSessionPack(v1, { current: 2, migrations: { 1: () => { throw new Error('bad shape'); } } });
    expect(boom.ok).toBe(false);
    if (!boom.ok) expect(boom.error.message).toMatch(/Could not upgrade .* bad shape/);
  });
});

describe('session pack schema', () => {
  const committed = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/schemas/session-pack.schema.json'), 'utf8')) as Json;

  it('is the committed docs/schemas/session-pack.schema.json (run pnpm run gen:session-pack-schema)', () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildSessionPackSchema())));
  });

  it('accepts and refuses the same files as the shipped validator', () => {
    const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: false, validateFormats: false });
    const validate = ajv.compile(committed);

    const bad = [
      (f: Json) => { set(f, 'trackStorage.kick.0.steps.0.velocity', 2); },
      (f: Json) => { set(f, 'session.columns.kick.clips.0.launchMode', 'warp'); },
      (f: Json) => { set(f, 'instruments', { synthA: { filterCutoff: 1 } }); },
      (f: Json) => { set(f, 'extra', 1); },
      (f: Json) => { set(f, 'trackStorage.kick.0.steps.0.url', 'x'); },
      (f: Json) => { set(f, 'formatVersion', 2); },
    ];
    const good: Array<(f: Json) => void> = [() => {}, (f) => { set(f, 'instruments', { synthB: { waveform: 'macro-va', macro: { polyphony: 1 } } }); }];
    for (const mutate of [...good, ...bad]) {
      const file = fixture();
      mutate(file);
      expect(validate_session_pack(file), mutate.toString()).toBe(validate(file));
    }
    for (const id of SESSION_PACKS.map((p) => p.id)) {
      const file: unknown = JSON.parse(exportBuiltIn(id).text);
      expect(validate(file), id).toBe(true);
      expect(validate_session_pack(file), id).toBe(true);
    }
  });
});

describe('export helpers', () => {
  it('slugifies names into valid, non-empty ids', () => {
    expect(slugifyPackId('Acid Set #2')).toBe('acid-set-2');
    expect(slugifyPackId('  Café — Nuit ')).toBe('cafe-nuit');
    expect(slugifyPackId('日本語')).toBe('session-pack');
    expect(slugifyPackId('')).toBe('session-pack');
    expect(slugifyPackId('x'.repeat(200))).toHaveLength(PACK_LIMITS.maxIdLength);
  });

  it('keeps only supported instrument fields, clamps them, and says what it dropped', () => {
    const { settings, dropped } = pickPackSynthSettings({
      waveform: 'cpp-saw' as never, // retired id → rewritten to a live one
      filterCutoff: 99999,
      volume: Number.NaN,
      model303Extra: { liveAbA: 1 } as never,
      model303: 'not-a-voice' as never,
      macro: { harmonics: -3, polyphony: 20 },
    });
    expect(settings.waveform).toBe('wam-saw');
    expect(settings.filterCutoff).toBe(20000);
    expect(settings.volume).toBeUndefined();
    expect(settings.macro).toEqual({ harmonics: 0, polyphony: 8 });
    expect(settings).not.toHaveProperty('model303Extra');
    expect(dropped).toEqual(['303 voice "not-a-voice"']);
  });

  it('stringifies like JSON.stringify but keeps short values on one line', () => {
    const value = { a: [1, 2, 3], steps: Array.from({ length: 12 }, (_, i) => ({ note: 'C4', velocity: i / 10 })), n: null };
    const text = stringifyPackFile(value);
    expect(JSON.parse(text)).toEqual(value);
    expect(text).toContain('"a": [1,2,3]');
    expect(text.split('\n').length).toBeGreaterThan(10);
  });
});

describe('docs/session-pack-format.md', () => {
  const doc = readFileSync(resolve(__dirname, '../../../docs/session-pack-format.md'), 'utf8');

  it('has a minimal example that the importer accepts as written', () => {
    const block = /## Minimal example[\s\S]*?```json\n([\s\S]*?)\n```/.exec(doc)?.[1];
    expect(block, 'the doc needs a ```json block under "## Minimal example"').toBeTruthy();
    const result = parseSessionPackText(block!);
    expect(result.ok, result.ok ? '' : result.errors[0].message).toBe(true);
    if (result.ok) {
      expect(result.pack.id).toBe('four-on-the-floor');
      expect(result.pack.session.scenes[0].clipIds.kick).toBe('c:kick:0');
      expect(result.pack.instruments?.synthA?.waveform).toBe('macro-additive');
    }
  });

  it('states the limits the code enforces', () => {
    expect(doc).toContain(`| File size | ${PACK_LIMITS.maxBytes / (1024 * 1024)} MiB`);
    expect(doc).toContain(`| Slots per track / rows / scenes | ${PACK_LIMITS.maxSlotsPerTrack} |`);
    expect(doc).toContain(`| Steps per pattern / sampler banks per slot | ${PACK_LIMITS.maxSteps} / ${PACK_LIMITS.maxSamplerBanks} |`);
    expect(doc).toContain(`| Issues listed for one failed import | ${PACK_LIMITS.maxReportedIssues} |`);
    expect(doc).toContain(`| Nesting depth | ${PACK_LIMITS.maxDepth} levels |`);
    expect(PACK_LIMITS.maxRows).toBe(PACK_LIMITS.maxSlotsPerTrack);
  });
});

