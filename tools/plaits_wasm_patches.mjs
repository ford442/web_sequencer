/**
 * Denormal guards applied to a staged copy of the Plaits / stmlib sources
 * before the macro-* voices are compiled (tools/plaits_sources.mjs). The
 * submodules themselves are never modified.
 *
 * Why. Plaits was written for a Cortex-M4, whose FPU flushes subnormals to
 * zero. WebAssembly has no flush-to-zero mode (its floats are IEEE with
 * gradual underflow) and x86 pays a microcode assist of ~100 cycles for every
 * operation that reads or produces a subnormal. A filter ringing down — an
 * exciter, a modal resonator, a Karplus-Strong loop — sits in that range,
 * often in a limit cycle that never reaches zero, and every sample after
 * that is slow: 8 held modal voices measured 1232 µs per 128-frame quantum
 * in V8 (46 % of the quantum) against ~96 µs with FTZ on the host.
 *
 * What. Each guard zeroes recursive state once it falls below 1e-15
 * (−300 dBFS, far under the 24-bit floor), at the end of a block where the
 * code has one, per sample only where the state lives in a sample loop with
 * no block boundary. That is the same thing FTZ does in hardware, 23 octaves
 * earlier, so the audio is unchanged; the host test renders every engine
 * through the staged copy.
 *
 * Found with x86 denormal-operand / underflow traps under gdb (unmask DM and
 * UM in MXCSR, run each engine, read the backtrace) — see
 * docs/audio-engine/macro-voices.md#denormals for the recipe. An upstream
 * bump that moves any `find` text fails the build by patch id.
 *
 * Shape: { id, file (repo-relative), why, edits: [{ find, replace, count? }] }
 */

/** The flush the guards use, spelled out so each replace stays one line. */
const FLUSH = (x) => `${x} = (${x} > -1e-15f && ${x} < 1e-15f) ? 0.0f : ${x};`;

export const PLAITS_WASM_PATCHES = [
  {
    id: 'stmlib-one-pole',
    file: 'third_party/stmlib/dsp/dsp.h',
    why: 'ONE_POLE / SLOPE smooth toward a target; one heading for 0 parks at the smallest subnormal for good.',
    edits: [
      {
        find: '#define ONE_POLE(out, in, coefficient) out += (coefficient) * ((in) - out);',
        // Still two plain statements, so call sites without a trailing ";" keep compiling.
        replace: `#define ONE_POLE(out, in, coefficient) out += (coefficient) * ((in) - out); ${FLUSH('out')}`,
      },
      {
        find: '  out += (error > 0 ? positive : negative) * error; \\\n}',
        replace: `  out += (error > 0 ? positive : negative) * error; \\\n  ${FLUSH('out')} \\\n}`,
      },
    ],
  },
  {
    id: 'stmlib-filters',
    file: 'third_party/stmlib/dsp/filter.h',
    why: 'Svf, OnePole, DCBlocker and NaiveSvf state rings down into subnormals once their input stops (exciters, the LPG, the string loop).',
    edits: [
      // Svf single-sample Process (both overloads).
      {
        find: '    state_2_ = g_ * bp + lp;\n',
        replace: `    state_2_ = g_ * bp + lp;\n    ${FLUSH('state_1_')}\n    ${FLUSH('state_2_')}\n`,
        count: 2,
      },
      // Svf block Process / ProcessAdd / ProcessMultimode…: once per block.
      {
        find: '    state_1_ = state_1;\n    state_2_ = state_2;\n',
        replace: `    ${FLUSH('state_1')}\n    ${FLUSH('state_2')}\n    state_1_ = state_1;\n    state_2_ = state_2;\n`,
        count: 6,
      },
      // OnePole::Process(float).
      {
        find: '    state_ = g_ * (in - lp) + lp;\n',
        replace: `    state_ = g_ * (in - lp) + lp;\n    ${FLUSH('state_')}\n`,
      },
      // DCBlocker::Process.
      {
        find: '    x_ = x;\n    y_ = y;\n',
        replace: `    ${FLUSH('y')}\n    x_ = x;\n    y_ = y;\n`,
      },
      // NaiveSvf::Process.
      {
        find: '    lp_ = lp;\n    bp_ = bp;\n    x_ = x;\n',
        replace: `    ${FLUSH('lp')}\n    ${FLUSH('bp')}\n    lp_ = lp;\n    bp_ = bp;\n    x_ = x;\n`,
      },
    ],
  },
  {
    id: 'plaits-envelopes',
    file: 'third_party/eurorack/plaits/dsp/envelope.h',
    why: 'The vactrol (LPG) state and the internal decay envelope decay geometrically toward 0 between notes.',
    edits: [
      {
        find: '    vactrol_state_ += vactrol_coefficient * vactrol_error;\n',
        replace: `    vactrol_state_ += vactrol_coefficient * vactrol_error;\n    ${FLUSH('vactrol_state_')}\n`,
      },
      {
        find: '    value_ *= (1.0f - decay);\n',
        replace: `    value_ *= (1.0f - decay);\n    ${FLUSH('value_')}\n`,
      },
    ],
  },
  {
    id: 'stmlib-parameter-interpolator',
    file: 'third_party/stmlib/dsp/parameter_interpolator.h',
    why: 'value_ += increment_ never lands exactly on a 0 target: the residue (e.g. -5.6e-45) is written back and every later block interpolates from a subnormal (chords, swarm gains).',
    edits: [
      {
        find: '  ~ParameterInterpolator() {\n    *state_ = value_;\n  }',
        replace: `  ~ParameterInterpolator() {\n    ${FLUSH('value_')}\n    *state_ = value_;\n  }`,
      },
    ],
  },
  {
    id: 'plaits-analog-bass-drum',
    file: 'third_party/eurorack/plaits/dsp/drums/analog_bass_drum.h',
    why: 'The trigger pulse and the retrigger pulse decay per sample toward 0.',
    edits: [
      {
        find: '        pulse_ *= 1.0f - 1.0f / kPulseDecayTime;\n',
        replace: `        pulse_ *= 1.0f - 1.0f / kPulseDecayTime;\n        ${FLUSH('pulse_')}\n`,
      },
      {
        find: '        retrig_pulse_ *= 1.0f - 1.0f / kRetrigPulseDuration;\n',
        replace: `        retrig_pulse_ *= 1.0f - 1.0f / kRetrigPulseDuration;\n        ${FLUSH('retrig_pulse_')}\n`,
      },
    ],
  },
  {
    id: 'plaits-analog-snare-drum',
    file: 'third_party/eurorack/plaits/dsp/drums/analog_snare_drum.h',
    why: 'The trigger pulse and the noise envelope decay per sample toward 0.',
    edits: [
      {
        find: '        pulse_ *= 1.0f - 1.0f / kPulseDecayTime;\n',
        replace: `        pulse_ *= 1.0f - 1.0f / kPulseDecayTime;\n        ${FLUSH('pulse_')}\n`,
      },
      {
        find: '      noise_envelope_ *= noise_envelope_decay;\n',
        replace: `      noise_envelope_ *= noise_envelope_decay;\n      ${FLUSH('noise_envelope_')}\n`,
      },
    ],
  },
  {
    id: 'plaits-hi-hat',
    file: 'third_party/eurorack/plaits/dsp/drums/hi_hat.h',
    why: 'The two-stage VCA envelope decays per sample toward 0.',
    edits: [
      {
        find: '          : cut_decay;\n',
        replace: `          : cut_decay;\n      ${FLUSH('envelope_')}\n`,
      },
    ],
  },
  {
    id: 'plaits-synthetic-bass-drum',
    file: 'third_party/eurorack/plaits/dsp/drums/synthetic_bass_drum.h',
    why: 'FM, body and transient envelopes decay per sample toward 0.',
    edits: [
      {
        find: '          fm_ *= fm_decay;\n',
        replace: `          fm_ *= fm_decay;\n          ${FLUSH('fm_')}\n`,
      },
      {
        find: '          body_env_ *= body_env_decay;\n          transient_env_ *= transient_env_decay;\n',
        replace: `          body_env_ *= body_env_decay;\n          transient_env_ *= transient_env_decay;\n          ${FLUSH('body_env_')}\n          ${FLUSH('transient_env_')}\n`,
      },
    ],
  },
  {
    id: 'plaits-synthetic-snare-drum',
    file: 'third_party/eurorack/plaits/dsp/drums/synthetic_snare_drum.h',
    why: 'Drum, snare and FM envelopes decay per sample toward 0.',
    edits: [
      {
        find: '        fm_ *= fm_decay;\n      }\n',
        replace: `        fm_ *= fm_decay;\n        ${FLUSH('drum_amplitude_')}\n        ${FLUSH('snare_amplitude_')}\n        ${FLUSH('fm_')}\n      }\n`,
      },
    ],
  },
  {
    id: 'plaits-swarm',
    file: 'third_party/eurorack/plaits/dsp/engine/swarm_engine.h',
    why: 'The grain envelope\'s crossfade coefficient decays by 0.95 per sample, forever.',
    edits: [
      {
        find: '    filter_coefficient_ *= 0.95f;\n',
        replace: `    filter_coefficient_ *= 0.95f;\n    ${FLUSH('filter_coefficient_')}\n`,
      },
    ],
  },
  {
    id: 'plaits-diffuser',
    file: 'third_party/eurorack/plaits/dsp/fx/diffuser.h',
    why: 'The particle engine\'s diffuser damping low-pass rings down between dust grains.',
    edits: [
      {
        find: '    lp_decay_ = lp;\n',
        replace: `    ${FLUSH('lp')}\n    lp_decay_ = lp;\n`,
      },
    ],
  },
  {
    id: 'plaits-resonator',
    file: 'third_party/eurorack/plaits/dsp/physical_modelling/resonator.h',
    why: 'The modal resonator\'s SVF bank: high modes die within milliseconds of a strike and then ring at subnormal level.',
    edits: [
      {
        find: '      state_1_[i] = state_1[i];\n      state_2_[i] = state_2[i];\n',
        replace: `      ${FLUSH('state_1[i]')}\n      ${FLUSH('state_2[i]')}\n      state_1_[i] = state_1[i];\n      state_2_[i] = state_2[i];\n`,
      },
    ],
  },
];
