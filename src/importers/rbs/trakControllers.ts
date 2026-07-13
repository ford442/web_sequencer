/**
 * Per-track TRAK controller IDs and event classification (rbs.h / RBS42).
 * TRAK ctrl bytes are **track-local** — not the legacy fixed-offset automation enum.
 */

import type { AutomationTarget } from '../../types';

/** Semantic category for a TRAK event after track + ctrl resolution. */
export type TrakEventKind =
  | 'patternSelect'
  | 'mute'
  | 'volume'
  | 'pan'
  | 'paramChange'
  | 'enabled'
  | 'routing'
  | 'unknown';

/** Mixer track controllers (rbs.h mixer_event_t). */
export const MIXER_TRAK_CONTROLLER = {
  COMPRESSOR_DEVICE_ID: 0x01,
  PCF_DEVICE_ID: 0x02,
  TB303A_MIX_LEVEL: 0x06,
  TB303A_PAN: 0x07,
  TB303A_DELAY: 0x08,
  TB303A_DIST: 0x09,
  TB303B_MIX_LEVEL: 0x0c,
  TB303B_PAN: 0x0d,
  TB303B_DELAY: 0x0e,
  TB303B_DIST: 0x0f,
  TR808_MIX_LEVEL: 0x12,
  TR808_PAN: 0x13,
  TR808_DELAY: 0x14,
  TR808_DIST: 0x15,
  TR909_MIX_LEVEL: 0x18,
  TR909_PAN: 0x19,
  TR909_DELAY: 0x1a,
  TR909_DIST: 0x1b,
} as const;

/** TB-303 track controllers (rbs.h tb303_event_t) — shared by 303 #1 and #2 tracks. */
export const TB303_TRAK_CONTROLLER = {
  ENABLED: 0x00,
  PATTERN_SELECT: 0x01,
  TUNE: 0x02,
  CUTOFF: 0x03,
  RESONANCE: 0x04,
  ENVMOD: 0x05,
  DECAY: 0x06,
  ACCENT: 0x07,
  WAVEFORM: 0x08,
} as const;

/** Drum machine track controllers (pattern select at 0x01 on TR-808 / TR-909). */
export const DRUM_TRAK_CONTROLLER = {
  ENABLED: 0x00,
  PATTERN_SELECT: 0x01,
} as const;

/** PCF effect track controllers (rbs.h pcf track). */
export const PCF_TRAK_CONTROLLER = {
  ENABLED: 0x00,
  FREQUENCY: 0x01,
  RESONANCE: 0x02,
  AMOUNT: 0x03,
  WAVE: 0x04,
  DECAY: 0x05,
  MODE: 0x06,
} as const;

/** Delay effect track controllers. */
export const DELAY_TRAK_CONTROLLER = {
  ENABLED: 0x00,
  STEPS: 0x01,
  STEP_MODE: 0x02,
  FEEDBACK: 0x03,
  PAN: 0x04,
} as const;

export interface TrakParamMapping {
  target: AutomationTarget;
  parameter: string;
  /** How to normalise raw TRAK bytes before scheduling. */
  valueScale: '0-127' | 'boolean' | 'raw';
}

function tb303ControllerMap(): Record<number, TrakEventKind> {
  return {
    [TB303_TRAK_CONTROLLER.ENABLED]: 'enabled',
    [TB303_TRAK_CONTROLLER.PATTERN_SELECT]: 'patternSelect',
    [TB303_TRAK_CONTROLLER.TUNE]: 'paramChange',
    [TB303_TRAK_CONTROLLER.CUTOFF]: 'paramChange',
    [TB303_TRAK_CONTROLLER.RESONANCE]: 'paramChange',
    [TB303_TRAK_CONTROLLER.ENVMOD]: 'paramChange',
    [TB303_TRAK_CONTROLLER.DECAY]: 'paramChange',
    [TB303_TRAK_CONTROLLER.ACCENT]: 'paramChange',
    [TB303_TRAK_CONTROLLER.WAVEFORM]: 'paramChange',
  };
}

function drumControllerMap(): Record<number, TrakEventKind> {
  return {
    [DRUM_TRAK_CONTROLLER.ENABLED]: 'enabled',
    [DRUM_TRAK_CONTROLLER.PATTERN_SELECT]: 'patternSelect',
  };
}

function mixerControllerMap(): Record<number, TrakEventKind> {
  return {
    [MIXER_TRAK_CONTROLLER.COMPRESSOR_DEVICE_ID]: 'routing',
    [MIXER_TRAK_CONTROLLER.PCF_DEVICE_ID]: 'routing',
    [MIXER_TRAK_CONTROLLER.TB303A_MIX_LEVEL]: 'volume',
    [MIXER_TRAK_CONTROLLER.TB303A_PAN]: 'pan',
    [MIXER_TRAK_CONTROLLER.TB303A_DELAY]: 'paramChange',
    [MIXER_TRAK_CONTROLLER.TB303A_DIST]: 'paramChange',
    [MIXER_TRAK_CONTROLLER.TB303B_MIX_LEVEL]: 'volume',
    [MIXER_TRAK_CONTROLLER.TB303B_PAN]: 'pan',
    [MIXER_TRAK_CONTROLLER.TB303B_DELAY]: 'paramChange',
    [MIXER_TRAK_CONTROLLER.TB303B_DIST]: 'paramChange',
    [MIXER_TRAK_CONTROLLER.TR808_MIX_LEVEL]: 'volume',
    [MIXER_TRAK_CONTROLLER.TR808_PAN]: 'pan',
    [MIXER_TRAK_CONTROLLER.TR808_DELAY]: 'paramChange',
    [MIXER_TRAK_CONTROLLER.TR808_DIST]: 'paramChange',
    [MIXER_TRAK_CONTROLLER.TR909_MIX_LEVEL]: 'volume',
    [MIXER_TRAK_CONTROLLER.TR909_PAN]: 'pan',
    [MIXER_TRAK_CONTROLLER.TR909_DELAY]: 'paramChange',
    [MIXER_TRAK_CONTROLLER.TR909_DIST]: 'paramChange',
  };
}

function pcfControllerMap(): Record<number, TrakEventKind> {
  return {
    [PCF_TRAK_CONTROLLER.ENABLED]: 'enabled',
    [PCF_TRAK_CONTROLLER.FREQUENCY]: 'paramChange',
    [PCF_TRAK_CONTROLLER.RESONANCE]: 'paramChange',
    [PCF_TRAK_CONTROLLER.AMOUNT]: 'paramChange',
    [PCF_TRAK_CONTROLLER.WAVE]: 'paramChange',
    [PCF_TRAK_CONTROLLER.DECAY]: 'paramChange',
    [PCF_TRAK_CONTROLLER.MODE]: 'paramChange',
  };
}

/** Per-track controller ID → semantic event kind (rbs.h). */
export const TRAK_TRACK_CONTROLLER_MAP: Record<number, Record<number, TrakEventKind>> = {
  0: mixerControllerMap(),
  1: tb303ControllerMap(),
  2: tb303ControllerMap(),
  3: drumControllerMap(),
  4: drumControllerMap(),
  5: {
    [DELAY_TRAK_CONTROLLER.ENABLED]: 'enabled',
    [DELAY_TRAK_CONTROLLER.STEPS]: 'paramChange',
    [DELAY_TRAK_CONTROLLER.STEP_MODE]: 'paramChange',
    [DELAY_TRAK_CONTROLLER.FEEDBACK]: 'paramChange',
    [DELAY_TRAK_CONTROLLER.PAN]: 'pan',
  },
  6: {
    0x00: 'enabled',
    0x01: 'paramChange',
    0x02: 'paramChange',
  },
  7: pcfControllerMap(),
  8: {
    0x00: 'enabled',
    0x01: 'paramChange',
    0x02: 'paramChange',
  },
};

/** Resolve semantic event kind for a TRAK (trackIndex, controllerId) pair. */
export function resolveTrakEventKind(trackIndex: number, controllerId: number): TrakEventKind {
  const trackMap = TRAK_TRACK_CONTROLLER_MAP[trackIndex];
  if (trackMap && trackMap[controllerId] !== undefined) {
    return trackMap[controllerId];
  }
  return 'unknown';
}

/** Whether this event selects a pattern bank index (arrangement, not knob automation). */
export function isTrakPatternSelectEvent(
  trackIndex: number,
  controllerId: number,
  eventKind?: TrakEventKind,
): boolean {
  if (eventKind === 'patternSelect') return true;
  const kind = eventKind ?? resolveTrakEventKind(trackIndex, controllerId);
  if (kind === 'patternSelect') return true;
  // Legacy tests: ctrl 0 on instrument tracks only (not mixer enabled toggle).
  if (controllerId === 0 && (trackIndex === 1 || trackIndex === 2 || trackIndex === 3 || trackIndex === 4)) {
    return true;
  }
  return false;
}

/** Whether this event should be scheduled as sub-step knob automation. */
export function isTrakParamAutomationEvent(
  trackIndex: number,
  controllerId: number,
  eventKind?: TrakEventKind,
): boolean {
  const kind = eventKind ?? resolveTrakEventKind(trackIndex, controllerId);
  return kind === 'paramChange';
}

/**
 * Map per-track TRAK controller to Hyphon automation target + parameter name.
 * Returns null for arrangement / mixer routing / unknown events.
 */
export function resolveTrakParamMapping(
  trackIndex: number,
  controllerId: number,
): TrakParamMapping | null {
  // TB-303 #1 → synthA (partA / lead303)
  if (trackIndex === 1) {
    switch (controllerId) {
      case TB303_TRAK_CONTROLLER.CUTOFF:
        return { target: 'synthA', parameter: 'filterCutoff', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.RESONANCE:
        return { target: 'synthA', parameter: 'filterResonance', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.ENVMOD:
        return { target: 'synthA', parameter: 'envMod', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.DECAY:
        return { target: 'synthA', parameter: 'decay', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.ACCENT:
        return { target: 'synthA', parameter: 'accent', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.TUNE:
        return { target: 'synthA', parameter: 'tune', valueScale: '0-127' };
      default:
        return null;
    }
  }

  // TB-303 #2 → synthB (partB / bass1)
  if (trackIndex === 2) {
    switch (controllerId) {
      case TB303_TRAK_CONTROLLER.CUTOFF:
        return { target: 'synthB', parameter: 'filterCutoff', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.RESONANCE:
        return { target: 'synthB', parameter: 'filterResonance', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.ENVMOD:
        return { target: 'synthB', parameter: 'envMod', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.DECAY:
        return { target: 'synthB', parameter: 'decay', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.ACCENT:
        return { target: 'synthB', parameter: 'accent', valueScale: '0-127' };
      case TB303_TRAK_CONTROLLER.TUNE:
        return { target: 'synthB', parameter: 'tune', valueScale: '0-127' };
      default:
        return null;
    }
  }

  // PCF effect track
  if (trackIndex === 7) {
    switch (controllerId) {
      case PCF_TRAK_CONTROLLER.FREQUENCY:
        return { target: 'master', parameter: 'pcfCutoff', valueScale: '0-127' };
      case PCF_TRAK_CONTROLLER.RESONANCE:
        return { target: 'master', parameter: 'pcfResonance', valueScale: '0-127' };
      case PCF_TRAK_CONTROLLER.AMOUNT:
        return { target: 'master', parameter: 'pcfEnvAmount', valueScale: '0-127' };
      default:
        return null;
    }
  }

  // Mixer sends that affect 303 levels
  if (trackIndex === 0) {
    switch (controllerId) {
      case MIXER_TRAK_CONTROLLER.TB303A_MIX_LEVEL:
        return { target: 'synthA', parameter: 'volume', valueScale: '0-127' };
      case MIXER_TRAK_CONTROLLER.TB303B_MIX_LEVEL:
        return { target: 'synthB', parameter: 'volume', valueScale: '0-127' };
      default:
        return null;
    }
  }

  return null;
}

/** Normalise a raw TRAK byte for the resolved parameter mapping. */
export function normaliseTrakParamValue(
  trackIndex: number,
  controllerId: number,
  rawValue: number,
): number {
  const mapping = resolveTrakParamMapping(trackIndex, controllerId);
  if (!mapping) {
    return Math.max(0, Math.min(1, rawValue / 127));
  }
  switch (mapping.valueScale) {
    case 'boolean':
      return rawValue > 0 ? 1 : 0;
    case 'raw':
      return rawValue;
  }
  return Math.max(0, Math.min(1, rawValue / 127));
}
