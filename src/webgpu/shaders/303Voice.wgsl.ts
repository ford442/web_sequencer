/**
 * WGSL TB-303 authenticity-tier voice (Phase-3 / #976).
 *
 * Topology mirrors OfflineHighFid303Engine / highfid303_wrapper.cpp:
 *   PolyBLEP saw / soft-driven square → diode-ladder (feedback HP @ 150 Hz,
 *   cubic soft-clip) → coupled accent envelope → VCA.
 *
 * Recursive filter state forces sequential sample processing inside one
 * compute invocation (workgroup_size 1). Parallelism is across independent
 * notes / multisample slots (dispatchWorkgroups), never inside the IIR.
 *
 * Offline / freeze / export only — never on the AudioWorklet thread.
 */

export const VOICE_303_WGSL = /* wgsl */ `
struct VoiceUniforms {
  sampleRate: f32,
  numSamples: u32,
  oversample: u32,
  numEvents: u32,
  waveform: f32,
  cutoff: f32,
  resonance: f32,
  envMod: f32,
  decay: f32,
  accent: f32,
  volume: f32,
  slideTime: f32,
  accentDecay: f32,
  squareDrv: f32,
  _pad0: f32,
  _pad1: f32,
};

struct NoteEvent {
  startSample: u32,
  midiNote: f32,
  velocity: f32,
  slide: u32,
};

@group(0) @binding(0) var<uniform> u: VoiceUniforms;
@group(0) @binding(1) var<storage, read> events: array<NoteEvent>;
@group(0) @binding(2) var<storage, read_write> audioOut: array<f32>;

const PI: f32 = 3.141592653589793;
const TWO_PI: f32 = 6.283185307179586;
const SQRT2: f32 = 1.41421356237;
const ACCENT_VEL: f32 = 100.0;
const FEEDBACK_HP_HZ: f32 = 150.0;

fn clampf(x: f32, lo: f32, hi: f32) -> f32 {
  return max(lo, min(hi, x));
}

fn fastTanh(x: f32) -> f32 {
  let x2 = x * x;
  return (x * (27.0 + x2)) / (27.0 + 9.0 * x2);
}

fn diodeShape(xIn: f32) -> f32 {
  let x = clampf(xIn, -SQRT2, SQRT2);
  return x - (x * x * x) / 6.0;
}

fn polyBlep(tIn: f32, dt: f32) -> f32 {
  if (dt <= 0.0) { return 0.0; }
  var t = tIn;
  if (t < dt) {
    t = t / dt;
    return t + t - t * t - 1.0;
  }
  if (t > 1.0 - dt) {
    t = (t - 1.0) / dt;
    return t * t + t + t + 1.0;
  }
  return 0.0;
}

fn midiToFreq(midi: f32) -> f32 {
  return 440.0 * pow(2.0, (midi - 69.0) / 12.0);
}

struct HpState {
  b0: f32,
  b1: f32,
  a1: f32,
  x1: f32,
  y1: f32,
};

fn hpInit(hz: f32, sr: f32) -> HpState {
  let h = clampf(hz, 1.0, sr * 0.45);
  let wc = (TWO_PI * h) / sr;
  let t = tan(wc * 0.5);
  let c = (1.0 - t) / (1.0 + t);
  return HpState((1.0 + c) * 0.5, -(1.0 + c) * 0.5, c, 0.0, 0.0);
}

fn hpProcess(st: ptr<function, HpState>, x: f32) -> f32 {
  let y = (*st).b0 * x + (*st).b1 * (*st).x1 + (*st).a1 * (*st).y1;
  (*st).x1 = x;
  (*st).y1 = y;
  return y;
}

struct LadderState {
  y1: f32,
  y2: f32,
  y3: f32,
  y4: f32,
  b0: f32,
  k: f32,
  g: f32,
  oscLpY: f32,
  oscLpCoeff: f32,
  hp: HpState,
};

fn ladderReset(st: ptr<function, LadderState>, sr: f32) {
  (*st).y1 = 0.0;
  (*st).y2 = 0.0;
  (*st).y3 = 0.0;
  (*st).y4 = 0.0;
  (*st).oscLpY = 0.0;
  (*st).oscLpCoeff = 0.5;
  (*st).b0 = 0.5;
  (*st).k = 0.0;
  (*st).g = 1.0;
  (*st).hp = hpInit(FEEDBACK_HP_HZ, sr);
}

fn ladderSetCutoff(st: ptr<function, LadderState>, cutoffHz: f32, resonance01: f32, sr: f32) {
  let cut = clampf(cutoffHz, 40.0, sr * 0.45);
  let r = clampf(resonance01, 0.0, 1.0);
  let resonanceSkewed = (1.0 - exp(-3.0 * r)) / (1.0 - exp(-3.0));
  let wc = (TWO_PI * cut) / sr;
  let fx = (wc * 0.7071067811865476) / TWO_PI;

  (*st).b0 =
    (0.00045522346 + 6.1922189 * fx) /
    (1.0 + 12.358354 * fx + 4.4156345 * (fx * fx));

  let kScale =
    fx *
      (fx *
        (fx * (fx * (fx * (fx + 7198.6997) - 5837.7917) - 476.47308) + 614.95611) +
        213.87126) +
    16.998792;
  var g = kScale * 0.058823529411764705;
  g = (g - 1.0) * resonanceSkewed + 1.0;
  g = g * (1.0 + resonanceSkewed);
  (*st).g = g;
  (*st).k = kScale * resonanceSkewed;

  let lpHz = clampf(cut * 2.5, 200.0, sr * 0.4);
  let lpWc = (TWO_PI * lpHz) / sr;
  (*st).oscLpCoeff = lpWc / (1.0 + lpWc);
}

fn ladderProcess(st: ptr<function, LadderState>, inputIn: f32) -> f32 {
  (*st).oscLpY += (*st).oscLpCoeff * (inputIn - (*st).oscLpY);
  let input = (*st).oscLpY;

  let fb = hpProcess(&(*st).hp, (*st).k * diodeShape((*st).y4));
  let y0 = input - fb;
  (*st).y1 += 2.0 * (*st).b0 * (y0 - (*st).y1 + (*st).y2);
  (*st).y2 += (*st).b0 * ((*st).y1 - 2.0 * (*st).y2 + (*st).y3);
  (*st).y3 += (*st).b0 * ((*st).y2 - 2.0 * (*st).y3 + (*st).y4);
  (*st).y4 += (*st).b0 * ((*st).y3 - 2.0 * (*st).y4);
  (*st).y1 = clampf((*st).y1, -8.0, 8.0);
  (*st).y2 = clampf((*st).y2, -8.0, 8.0);
  (*st).y3 = clampf((*st).y3, -8.0, 8.0);
  (*st).y4 = clampf((*st).y4, -8.0, 8.0);
  let out = 2.0 * (*st).g * (*st).y4;
  if (!(out == out)) {
    ladderReset(st, 44100.0);
    return 0.0;
  }
  return out;
}

struct VoiceState {
  phase: f32,
  currentFreq: f32,
  targetFreq: f32,
  slideCoeff: f32,
  envLevel: f32,
  envDecayRate: f32,
  accentEnv: f32,
  accentAttackRate: f32,
  accentDecayRate: f32,
  accentAttacking: u32,
  accented: u32,
  gateOpen: u32,
  ladder: LadderState,
};

fn updateRates(vs: ptr<function, VoiceState>, sr: f32) {
  var timeS = 0.05 + u.decay * 1.95;
  if ((*vs).accented == 1u) {
    timeS *= 0.05 + u.accentDecay * 0.95;
  }
  (*vs).envDecayRate = exp(-1.0 / (sr * timeS));
  (*vs).accentAttackRate = 1.0 - exp(-1.0 / (sr * 0.003));
  let accDecS = 0.04 + u.accent * 0.08;
  (*vs).accentDecayRate = exp(-1.0 / (sr * accDecS));
}

fn updateFilter(vs: ptr<function, VoiceState>, sr: f32) {
  var envBoost = u.envMod * (*vs).envLevel;
  if ((*vs).accented == 1u) {
    envBoost += u.accent * 0.45 * (*vs).accentEnv;
  }
  let total = clampf(u.cutoff + envBoost, 0.0, 1.0);
  let hz = 200.0 * pow(4500.0 / 200.0, total);
  ladderSetCutoff(&(*vs).ladder, hz, u.resonance, sr);
}

fn noteOn(vs: ptr<function, VoiceState>, midi: f32, velocity: f32, slide: bool, sr: f32) {
  let freq = midiToFreq(midi);
  (*vs).targetFreq = freq;
  if ((*vs).gateOpen == 1u && u.slideTime > 0.0 && (*vs).currentFreq > 0.0 && slide) {
    let slideSeconds = 0.01 + u.slideTime * 0.49;
    let ratio = (*vs).targetFreq / (*vs).currentFreq;
    if (ratio > 0.0 && ratio != 1.0) {
      (*vs).slideCoeff = pow(ratio, 1.0 / (slideSeconds * sr));
    } else {
      (*vs).slideCoeff = 1.0;
      (*vs).currentFreq = (*vs).targetFreq;
    }
  } else {
    (*vs).currentFreq = freq;
    (*vs).slideCoeff = 1.0;
  }
  (*vs).accented = select(0u, 1u, velocity > ACCENT_VEL);
  (*vs).gateOpen = 1u;
  (*vs).envLevel = 1.0;
  if ((*vs).accented == 1u) {
    (*vs).accentEnv = 0.0;
    (*vs).accentAttacking = 1u;
  } else {
    (*vs).accentEnv = 0.0;
    (*vs).accentAttacking = 0u;
  }
  updateRates(vs, sr);
  updateFilter(vs, sr);
}

fn noteOff(vs: ptr<function, VoiceState>) {
  (*vs).gateOpen = 0u;
}

fn renderOsc(vs: ptr<function, VoiceState>, sr: f32) -> f32 {
  let phaseInc = (*vs).currentFreq / sr;
  (*vs).phase += phaseInc;
  if ((*vs).phase >= 1.0) {
    (*vs).phase -= 1.0;
  }

  if (u.waveform < 0.5) {
    var osc = 2.0 * (*vs).phase - 1.0;
    osc -= polyBlep((*vs).phase, phaseInc);
    return osc;
  }
  var sq = select(-1.0, 1.0, (*vs).phase < 0.5);
  sq += polyBlep((*vs).phase, phaseInc);
  var t2 = (*vs).phase + 0.5;
  if (t2 >= 1.0) { t2 -= 1.0; }
  sq -= polyBlep(t2, phaseInc);
  let drive = 1.0 + u.squareDrv * 2.5;
  return fastTanh(sq * drive);
}

fn renderSample(vs: ptr<function, VoiceState>, sr: f32) -> f32 {
  if ((*vs).slideCoeff != 1.0) {
    (*vs).currentFreq *= (*vs).slideCoeff;
    let reached = select(
      (*vs).currentFreq <= (*vs).targetFreq,
      (*vs).currentFreq >= (*vs).targetFreq,
      (*vs).slideCoeff > 1.0,
    );
    if (reached) {
      (*vs).currentFreq = (*vs).targetFreq;
      (*vs).slideCoeff = 1.0;
    }
  }

  (*vs).envLevel *= (*vs).envDecayRate;
  if ((*vs).envLevel < 1e-6) { (*vs).envLevel = 0.0; }

  if ((*vs).accented == 1u) {
    if ((*vs).accentAttacking == 1u) {
      (*vs).accentEnv += (1.0 - (*vs).accentEnv) * (*vs).accentAttackRate;
      if ((*vs).accentEnv > 0.995) {
        (*vs).accentEnv = 1.0;
        (*vs).accentAttacking = 0u;
      }
    } else {
      (*vs).accentEnv *= (*vs).accentDecayRate;
      if ((*vs).accentEnv < 1e-6) { (*vs).accentEnv = 0.0; }
    }
  }

  updateFilter(vs, sr);
  let osc = renderOsc(vs, sr);
  let filtered = ladderProcess(&(*vs).ladder, osc);
  var gain = u.volume;
  if ((*vs).accented == 1u) {
    gain *= 1.0 + u.accent * 0.35 * (*vs).accentEnv;
  }
  var out = filtered * gain * 0.55;
  if (!(out == out)) {
    ladderReset(&(*vs).ladder, sr);
    return 0.0;
  }
  return clampf(out, -1.5, 1.5);
}

@compute @workgroup_size(1)
fn render303(@builtin(workgroup_id) wid: vec3<u32>) {
  // Single-voice sequential render (wid.x must be 0 for pattern mode).
  if (wid.x != 0u) { return; }

  let nSamples = u.numSamples;
  let os = max(u.oversample, 1u);
  let srBase = u.sampleRate;
  let srEff = srBase * f32(os);

  var vs: VoiceState;
  vs.phase = 0.0;
  vs.currentFreq = 440.0;
  vs.targetFreq = 440.0;
  vs.slideCoeff = 1.0;
  vs.envLevel = 0.0;
  vs.envDecayRate = 0.999;
  vs.accentEnv = 0.0;
  vs.accentAttackRate = 0.0;
  vs.accentDecayRate = 0.0;
  vs.accentAttacking = 0u;
  vs.accented = 0u;
  vs.gateOpen = 0u;
  ladderReset(&vs.ladder, srEff);
  updateRates(&vs, srEff);
  updateFilter(&vs, srEff);

  var nextEvent: u32 = 0u;
  let invOs = 1.0 / f32(os);

  for (var i: u32 = 0u; i < nSamples; i++) {
    // Fire all events scheduled at this sample index.
    loop {
      if (nextEvent >= u.numEvents) { break; }
      let ev = events[nextEvent];
      if (ev.startSample != i) { break; }
      let isSlide = ev.slide != 0u;
      if (!isSlide && vs.gateOpen == 1u) {
        noteOff(&vs);
      }
      noteOn(&vs, ev.midiNote, ev.velocity, isSlide, srEff);
      nextEvent += 1u;
    }

    var acc = 0.0;
    for (var s: u32 = 0u; s < os; s++) {
      acc += renderSample(&vs, srEff);
    }
    audioOut[i] = acc * invOs;
  }
}
`;

/** Byte size of VoiceUniforms (16 × f32/u32 with padding). */
export const VOICE_303_UNIFORM_BYTES = 64;

/** Byte size of one NoteEvent (4 × 4 bytes). */
export const NOTE_EVENT_BYTES = 16;
