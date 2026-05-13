/**
 * Automation Lane Support for AI Song Importer
 *
 * Handles conversion, validation, and manipulation of automation lanes
 * from AI-generated song data.
 *
 * @example
 * ```typescript
 * import { validateAutomation, convertAutomationToPoints } from './automation';
 *
 * // Validate automation lanes
 * const result = validateAutomation(aiSong.automation, aiSong.tracks);
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 *
 * // Convert to Hyphon format
 * const points = convertAutomationToPoints(automationLane);
 * ```
 */

import type { 
  AIAutomationLane, 
  AIAutomationTarget, 
  AITargetedParameter, 
  AIInterpolationMode,
  AISongData 
} from './AISongImporter';
import type { AutomationPoint } from '../../types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Valid automation targets */
export const VALID_AUTOMATION_TARGETS: readonly AIAutomationTarget[] = [
  'synthA', 'synthB', 'bass2', 'kick', 'snare', 
  'closedHat', 'openHat', 'sampler', 'master'
] as const;

/** Valid parameters for each target */
export const VALID_PARAMETERS_BY_TARGET: Readonly<Record<AIAutomationTarget, readonly AITargetedParameter[]>> = {
  synthA: ['filterCutoff', 'filterResonance', 'filterMode', 'pitchDecay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive', 'delayTime', 'delayFeedback', 'delayMix'],
  synthB: ['filterCutoff', 'filterResonance', 'filterMode', 'pitchDecay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive', 'delayTime', 'delayFeedback', 'delayMix'],
  bass2: ['filterCutoff', 'filterResonance', 'filterMode', 'pitchDecay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive'],
  kick: ['pitch', 'pitchDecay', 'tone', 'volume'],
  snare: ['pitchDecay', 'tone', 'noise', 'volume'],
  closedHat: ['pitch', 'pitchDecay', 'volume'],
  openHat: ['pitch', 'pitchDecay', 'volume'],
  sampler: ['filterCutoff', 'filterResonance', 'drive', 'volume', 'playbackSpeed', 'pitch'],
  master: ['tempo', 'swing', 'masterVolume']
} as const;

/** Valid interpolation modes */
export const VALID_INTERPOLATION_MODES: readonly AIInterpolationMode[] = ['step', 'linear', 'smooth'] as const;

/** Default pattern length for Hyphon */
export const DEFAULT_PATTERN_LENGTH = 32;

/** MIDI value range for automation (0-127) */
export const MIDI_VALUE_RANGE = { min: 0, max: 127 } as const;

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validation error details
 */
export interface AutomationValidationError {
  type: 'VALIDATION_ERROR';
  field: string;
  message: string;
}

/**
 * Validation result type
 */
export type AutomationValidationResult = 
  | { valid: true }
  | { valid: false; error: AutomationValidationError };

/**
 * Validate automation lanes against the AISongData schema.
 * 
 * Checks:
 * - Automation is an array
 * - Each lane has valid target and parameter
 * - Step count matches pattern length
 * - Step values are in valid range (0-127 or null)
 * - Interpolation mode is valid
 * 
 * @param automation - Array of automation lanes to validate
 * @param tracks - Tracks object to determine pattern length
 * @returns Validation result
 * 
 * @example
 * ```typescript
 * const result = validateAutomation(aiSong.automation, aiSong.tracks);
 * if (!result.valid) {
 *   console.error(`Validation failed: ${result.error.message}`);
 * }
 * ```
 */
export function validateAutomation(
  automation: unknown, 
  tracks: AISongData['tracks']
): AutomationValidationResult {
  if (!Array.isArray(automation)) {
    return { 
      valid: false, 
      error: { type: 'VALIDATION_ERROR', field: 'automation', message: 'automation must be an array' } 
    };
  }

  // Determine expected step count from tracks (default to 32)
  const expectedSteps = determinePatternLength(tracks);

  for (let i = 0; i < automation.length; i++) {
    const lane = automation[i] as Partial<AIAutomationLane>;
    const lanePrefix = `automation[${i}]`;

    // Check target
    if (!lane.target || !VALID_AUTOMATION_TARGETS.includes(lane.target as AIAutomationTarget)) {
      return {
        valid: false,
        error: { 
          type: 'VALIDATION_ERROR', 
          field: `${lanePrefix}.target`, 
          message: `Invalid target "${lane.target}". Must be one of: ${VALID_AUTOMATION_TARGETS.join(', ')}` 
        }
      };
    }

    const target = lane.target as AIAutomationTarget;

    // Check parameter is valid for target
    if (!lane.parameter || !VALID_PARAMETERS_BY_TARGET[target].includes(lane.parameter as AITargetedParameter)) {
      return {
        valid: false,
        error: { 
          type: 'VALIDATION_ERROR', 
          field: `${lanePrefix}.parameter`, 
          message: `Invalid parameter "${lane.parameter}" for target "${target}". Valid: ${[...VALID_PARAMETERS_BY_TARGET[target]].join(', ')}` 
        }
      };
    }

    // Validate steps array
    if (!Array.isArray(lane.steps)) {
      return {
        valid: false,
        error: { type: 'VALIDATION_ERROR', field: `${lanePrefix}.steps`, message: 'steps must be an array' }
      };
    }

    if (lane.steps.length !== expectedSteps) {
      return {
        valid: false,
        error: { 
          type: 'VALIDATION_ERROR', 
          field: `${lanePrefix}.steps`, 
          message: `steps length (${lane.steps.length}) must match pattern length (${expectedSteps})` 
        }
      };
    }

    // Validate step values (0-127 or null)
    for (let s = 0; s < lane.steps.length; s++) {
      const value = lane.steps[s];
      if (value !== null && (typeof value !== 'number' || value < MIDI_VALUE_RANGE.min || value > MIDI_VALUE_RANGE.max)) {
        return {
          valid: false,
          error: { 
            type: 'VALIDATION_ERROR', 
            field: `${lanePrefix}.steps[${s}]`, 
            message: `Step values must be ${MIDI_VALUE_RANGE.min}-${MIDI_VALUE_RANGE.max} or null, got ${value}` 
          }
        };
      }
    }

    // Validate interpolation if provided
    if (lane.interpolation !== undefined && !VALID_INTERPOLATION_MODES.includes(lane.interpolation)) {
      return {
        valid: false,
        error: { 
          type: 'VALIDATION_ERROR', 
          field: `${lanePrefix}.interpolation`, 
          message: `Invalid interpolation "${lane.interpolation}". Must be: ${VALID_INTERPOLATION_MODES.join(', ')}` 
        }
      };
    }
  }

  return { valid: true };
}

/**
 * Check if a target+parameter combination is valid.
 * 
 * @param target - The automation target
 * @param parameter - The parameter to automate
 * @returns True if the combination is valid
 * 
 * @example
 * ```typescript
 * if (isValidAutomationTarget('synthA', 'filterCutoff')) {
 *   // Valid combination
 * }
 * ```
 */
export function isValidAutomationTarget(
  target: AIAutomationTarget, 
  parameter: AITargetedParameter
): boolean {
  if (!VALID_AUTOMATION_TARGETS.includes(target)) {
    return false;
  }
  return VALID_PARAMETERS_BY_TARGET[target].includes(parameter);
}

// ============================================================================
// CONVERSION
// ============================================================================

/**
 * Convert an AI automation lane to Hyphon automation points.
 * 
 * Maps per-step values (0-127) to Hyphon's normalized range (0-1).
 * Only non-null steps create automation points.
 * 
 * @param lane - The automation lane to convert
 * @returns Array of automation points ready for Hyphon
 * 
 * @example
 * ```typescript
 * const lane: AIAutomationLane = {
 *   target: 'synthA',
 *   parameter: 'filterCutoff',
 *   steps: [64, null, 127, 32],
 *   interpolation: 'linear'
 * };
 * const points = convertAutomationToPoints(lane);
 * // Returns: [{ step: 0, value: 0.5 }, { step: 2, value: 1.0 }, { step: 3, value: 0.25 }]
 * ```
 */
export function convertAutomationToPoints(lane: AIAutomationLane): AutomationPoint[] {
  const points: AutomationPoint[] = [];
  
  for (let step = 0; step < lane.steps.length; step++) {
    const value = lane.steps[step];
    if (value !== null) {
      // Convert 0-127 to 0-1 range for Hyphon
      points.push({
        step,
        value: value / MIDI_VALUE_RANGE.max
      });
    }
  }
  
  return points;
}

/**
 * Map AI automation target to Hyphon track key.
 * 
 * @param target - AI automation target
 * @returns Hyphon track key
 * 
 * @example
 * ```typescript
 * const trackKey = mapTargetToTrackKey('synthA'); // Returns: 'partA'
 * ```
 */
export function mapTargetToTrackKey(target: AIAutomationTarget): string {
  const mapping: Record<AIAutomationTarget, string> = {
    synthA: 'partA',
    synthB: 'partB',
    bass2: 'bass2',
    kick: 'kick',
    snare: 'snare',
    closedHat: 'closedHat',
    openHat: 'openHat',
    sampler: 'sampler',
    master: 'master'
  };
  return mapping[target];
}

// ============================================================================
// SUMMARY & METADATA
// ============================================================================

/**
 * Automation lane summary for UI display.
 */
export interface AutomationLaneSummary {
  target: AIAutomationTarget;
  parameter: AITargetedParameter;
  pointCount: number;
  interpolation: AIInterpolationMode;
  minValue: number | null;
  maxValue: number | null;
}

/**
 * Get a human-readable summary of automation lanes.
 * 
 * @param automation - Array of automation lanes
 * @returns Summary with lane count and details
 * 
 * @example
 * ```typescript
 * const summary = getAutomationSummary(aiSong.automation);
 * console.log(`${summary.laneCount} automation lanes`);
 * summary.lanes.forEach(lane => {
 *   console.log(`${lane.target}.${lane.parameter}: ${lane.pointCount} points`);
 * });
 * ```
 */
export function getAutomationSummary(
  automation: AIAutomationLane[] | undefined
): {
  laneCount: number;
  totalPoints: number;
  lanes: AutomationLaneSummary[];
} {
  if (!automation || automation.length === 0) {
    return { laneCount: 0, totalPoints: 0, lanes: [] };
  }

  let totalPoints = 0;
  const lanes: AutomationLaneSummary[] = automation.map(lane => {
    const values = lane.steps.filter((s): s is number => s !== null);
    const pointCount = values.length;
    totalPoints += pointCount;

    return {
      target: lane.target,
      parameter: lane.parameter,
      pointCount,
      interpolation: lane.interpolation || 'step',
      minValue: values.length > 0 ? Math.min(...values) : null,
      maxValue: values.length > 0 ? Math.max(...values) : null
    };
  });

  return {
    laneCount: automation.length,
    totalPoints,
    lanes
  };
}

/**
 * Get all valid parameters for a target.
 * 
 * @param target - The automation target
 * @returns Array of valid parameters, or empty array if target is invalid
 * 
 * @example
 * ```typescript
 * const params = getValidParametersForTarget('synthA');
 * // Returns: ['filterCutoff', 'filterResonance', ...]
 * ```
 */
export function getValidParametersForTarget(target: AIAutomationTarget): readonly AITargetedParameter[] {
  return VALID_PARAMETERS_BY_TARGET[target] || [];
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Determine pattern length from track data.
 * 
 * Checks drum track lengths to infer pattern size.
 * Defaults to 32 steps (Hyphon standard).
 * 
 * @param tracks - Tracks object from AISongData
 * @returns Pattern length (16 or 32)
 */
export function determinePatternLength(tracks: AISongData['tracks']): number {
  // Check drum tracks for length
  const drumTracks: (boolean[] | undefined)[] = [
    tracks.kick, 
    tracks.snare, 
    tracks.closedHat, 
    tracks.openHat
  ];
  
  for (const track of drumTracks) {
    if (track && track.length > 0) {
      return track.length <= 16 ? 16 : 32;
    }
  }
  
  // Default to 32 steps for Hyphon compatibility
  return DEFAULT_PATTERN_LENGTH;
}

/**
 * Create an empty automation lane.
 * 
 * @param target - The automation target
 * @param parameter - The parameter to automate
 * @param length - Number of steps (default: 32)
 * @returns New automation lane with all null steps
 * 
 * @example
 * ```typescript
 * const lane = createEmptyAutomationLane('synthA', 'filterCutoff', 32);
 * ```
 */
export function createEmptyAutomationLane(
  target: AIAutomationTarget,
  parameter: AITargetedParameter,
  length: number = DEFAULT_PATTERN_LENGTH
): AIAutomationLane {
  return {
    target,
    parameter,
    steps: Array(length).fill(null),
    interpolation: 'step'
  };
}

/**
 * Interpolate automation values between points.
 * 
 * @param points - Array of automation points
 * @param length - Total pattern length
 * @param mode - Interpolation mode
 * @returns Array of interpolated values
 * 
 * @example
 * ```typescript
 * const interpolated = interpolateAutomation(
 *   [{ step: 0, value: 0 }, { step: 4, value: 1 }],
 *   8,
 *   'linear'
 * );
 * // Returns: [0, 0.25, 0.5, 0.75, 1, 1, 1, 1]
 * ```
 */
export function interpolateAutomation(
  points: AutomationPoint[],
  length: number,
  mode: AIInterpolationMode = 'linear'
): number[] {
  if (points.length === 0) {
    return Array(length).fill(0);
  }

  const result: number[] = [];
  let currentPointIdx = 0;

  for (let step = 0; step < length; step++) {
    // Find the current segment
    while (currentPointIdx < points.length - 1 && points[currentPointIdx + 1].step <= step) {
      currentPointIdx++;
    }

    if (currentPointIdx >= points.length - 1) {
      // Past last point, hold value
      result.push(points[points.length - 1].value);
    } else if (points[currentPointIdx].step === step) {
      // Exact point
      result.push(points[currentPointIdx].value);
    } else {
      // Interpolate between current and next point
      const current = points[currentPointIdx];
      const next = points[currentPointIdx + 1];
      
      if (mode === 'step') {
        result.push(current.value);
      } else {
        const t = (step - current.step) / (next.step - current.step);
        const easedT = mode === 'smooth' ? easeInOutCubic(t) : t;
        result.push(current.value + (next.value - current.value) * easedT);
      }
    }
  }

  return result;
}

/**
 * Cubic ease-in-out function for smooth interpolation.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ============================================================================
// EXAMPLE DATA
// ============================================================================

/**
 * Example AI Song with automation for documentation and testing.
 * 
 * Demonstrates filter sweeps on synthA and delay mix automation on synthB.
 */
export const EXAMPLE_WITH_AUTOMATION: AISongData = {
  meta: { 
    title: "Acid with Filter Sweep", 
    author: "AI Demo", 
    version: "1.0", 
    createdAt: "2024-03-06T12:00:00Z", 
    generator: "claude-3-opus", 
    prompt: "Acid techno with filter automation",
    tags: ["techno", "acid", "automation"]
  },
  globals: { 
    tempo: 130, 
    timeSignature: [4, 4], 
    swing: 52 
  },
  tracks: {
    synthA: { 
      notes: [
        {step: 0, note: "C2", velocity: 0.9, accent: true},
        {step: 2, note: "C2"},
        {step: 4, note: "Eb2", accent: true, slide: true},
        {step: 6, note: "F2"},
        {step: 8, note: "C2", accent: true},
        {step: 12, note: "G2", accent: true, slide: true},
        {step: 14, note: "Bb2"}
      ], 
      params: { 
        waveform: "303-saw", 
        filterCutoff: 1500, 
        filterResonance: 18, 
        pitchDecay: 0.4
      } 
    },
    kick: [
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false
    ],
    snare: [
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false
    ],
    closedHat: [
      false, true, false, true, false, true, false, true,
      false, true, false, true, false, true, false, true
    ]
  },
  automation: [
    {
      target: 'synthA',
      parameter: 'filterCutoff',
      steps: [
        100, 110, 120, 127, 120, 110, 100, 90,
        null, null, 100, 110, 120, 127, 120, 100
      ],
      interpolation: 'linear'
    },
    {
      target: 'synthB',
      parameter: 'delayMix',
      steps: [
        0, 0, 10, 20, 30, 40, 50, 60,
        70, 80, 90, 100, 100, 100, 80, 60
      ],
      interpolation: 'smooth'
    }
  ]
};

export default {
  validateAutomation,
  isValidAutomationTarget,
  convertAutomationToPoints,
  mapTargetToTrackKey,
  getAutomationSummary,
  getValidParametersForTarget,
  determinePatternLength,
  createEmptyAutomationLane,
  interpolateAutomation,
  VALID_AUTOMATION_TARGETS,
  VALID_PARAMETERS_BY_TARGET,
  VALID_INTERPOLATION_MODES,
  DEFAULT_PATTERN_LENGTH,
  MIDI_VALUE_RANGE,
  EXAMPLE_WITH_AUTOMATION
};
