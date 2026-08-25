import React from 'react';
import type { WamHost } from '../audio/wam/WamHost';
import type { Wam2PackageDescriptor, Wam2ParamDesc } from '../audio/wam/types';
import {
  deletePreset,
  listPresets,
  savePreset,
  type Wam2StoredPreset,
} from '../audio/wam/presets';
import { automationStore, generateLaneId } from '../stores/automationStore';
import type { UnifiedAutomationLane } from '../types';

/**
 * Fallback editor for a WAM2 plugin that ships no UI of its own.
 *
 * The param list comes from the descriptor, so this works identically for a
 * bundled fixture and an allowlisted community package — a package does not have
 * to ship a UI to be usable or automatable.
 *
 * Accessibility: every control is a native `<input>`/`<button>` with a real
 * `<label htmlFor>`, so the whole panel is reachable and operable by keyboard
 * with no custom key handling. Range inputs already support arrows/Home/End.
 * Live values are announced through `aria-valuetext` rather than a separate
 * live region, which would fire on every drag frame.
 */

export interface Wam2GenericEditorProps {
  host: WamHost;
  slotId: string;
  descriptor: Wam2PackageDescriptor;
  /** Pattern the created automation lane belongs to. */
  patternIndex?: number;
  onChange?: (paramId: string, value: number) => void;
}

function formatValue(param: Wam2ParamDesc, value: number): string {
  const span = param.max - param.min;
  if (span >= 100) return value.toFixed(0);
  if (span >= 2) return value.toFixed(2);
  return value.toFixed(3);
}

/** Lane id for a WAM2 param, per AutomationScheduler: `slotId/paramId`. */
export function wam2LaneParameter(slotId: string, paramId: string): string {
  return `${slotId}/${paramId}`;
}

function stepFor(param: Wam2ParamDesc): number {
  const span = param.max - param.min;
  // 1000 steps across the range, rounded to something a keyboard user can land on.
  if (span >= 1000) return 1;
  if (span >= 10) return 0.1;
  return span / 1000;
}

export const Wam2GenericEditor: React.FC<Wam2GenericEditorProps> = ({
  host,
  slotId,
  descriptor,
  patternIndex = 0,
  onChange,
}) => {
  const [values, setValues] = React.useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const param of descriptor.params) {
      initial[param.id] = host.getParam(slotId, param.id) ?? param.defaultValue;
    }
    return initial;
  });
  /**
   * Text the user is part-way through typing in a number field.
   *
   * The number inputs cannot clamp on every keystroke: typing "5000" into a
   * field whose min is 80 passes through "5", which would clamp to 80 and leave
   * the caret in a field reading "80" — the intended value becomes untypeable.
   * So a draft is held verbatim while the field has focus and only committed
   * (and clamped) on blur or Enter. In-range keystrokes still apply live, so
   * dragging-by-typing keeps working.
   */
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [presets, setPresets] = React.useState<Wam2StoredPreset[]>(() =>
    listPresets(descriptor.id),
  );
  const [presetName, setPresetName] = React.useState('');
  const [status, setStatus] = React.useState<string>('');

  const setParam = React.useCallback(
    (param: Wam2ParamDesc, raw: number) => {
      const value = Math.min(param.max, Math.max(param.min, raw));
      host.setParam(slotId, param.id, value);
      setValues((prev) => ({ ...prev, [param.id]: value }));
      onChange?.(param.id, value);
      return value;
    },
    [host, slotId, onChange],
  );

  /** Clamp and apply whatever is in the draft, then drop it. */
  const commitDraft = React.useCallback(
    (param: Wam2ParamDesc) => {
      setDrafts((prev) => {
        const text = prev[param.id];
        if (text === undefined) return prev;
        const parsed = Number(text);
        setParam(param, Number.isFinite(parsed) && text !== '' ? parsed : (values[param.id] ?? param.defaultValue));
        const next = { ...prev };
        delete next[param.id];
        return next;
      });
    },
    [setParam, values],
  );

  const addAutomationLane = React.useCallback(
    (param: Wam2ParamDesc) => {
      const parameter = wam2LaneParameter(slotId, param.id);
      const existing = automationStore
        .getState()
        .lanes.find((lane) => lane.target === 'wam' && lane.parameter === parameter);
      if (existing) {
        setStatus(`Automation lane for ${param.label} already exists`);
        return;
      }
      const lane: UnifiedAutomationLane = {
        id: generateLaneId(),
        target: 'wam',
        parameter,
        name: `${descriptor.title} · ${param.label}`,
        points: [{ step: 0, value: values[param.id] ?? param.defaultValue }],
        interpolation: 'linear',
        source: 'manual',
        scope: 'pattern',
        patternIndex,
        enabled: true,
        originalRange: [param.min, param.max],
      };
      automationStore.addLane(lane);
      setStatus(`Automation lane created for ${param.label}`);
    },
    [slotId, descriptor.title, values, patternIndex],
  );

  const onSavePreset = React.useCallback(() => {
    const preset = host.capturePreset(slotId);
    if (!preset) {
      setStatus('Slot is not mounted — nothing to save');
      return;
    }
    const stored = savePreset(presetName, preset);
    setPresets(listPresets(descriptor.id));
    setPresetName('');
    setStatus(`Saved preset "${stored.name}"`);
  }, [host, slotId, presetName, descriptor.id]);

  const onLoadPreset = React.useCallback(
    (preset: Wam2StoredPreset) => {
      if (!host.applyPreset(slotId, preset)) {
        // applyPreset refuses a preset from a different package rather than
        // half-applying it.
        setStatus(`Preset "${preset.name}" does not belong to ${descriptor.id}`);
        return;
      }
      const next: Record<string, number> = {};
      for (const param of descriptor.params) {
        next[param.id] = host.getParam(slotId, param.id) ?? param.defaultValue;
      }
      setValues(next);
      setDrafts({});
      setStatus(`Loaded preset "${preset.name}"`);
    },
    [host, slotId, descriptor],
  );

  const onDeletePreset = React.useCallback(
    (preset: Wam2StoredPreset) => {
      deletePreset(descriptor.id, preset.name);
      setPresets(listPresets(descriptor.id));
      setStatus(`Deleted preset "${preset.name}"`);
    },
    [descriptor.id],
  );

  const headingId = `wam2-editor-${slotId}-heading`;

  return (
    <section
      className="flex flex-col gap-3 rounded border border-gray-700 bg-gray-900 p-3"
      aria-labelledby={headingId}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-orbitron text-sm text-gray-100">
          {descriptor.title}
        </h3>
        <p className="text-xs text-gray-400">
          {descriptor.id}@{descriptor.version} · {descriptor.origin}
          {descriptor.offline === 'unsupported' && (
            <>
              {' · '}
              <span
                className="rounded bg-amber-900/60 px-1 text-amber-200"
                title="This plugin cannot be rendered in an OfflineAudioContext, so track freeze is unavailable for it."
              >
                no freeze
              </span>
            </>
          )}
        </p>
      </header>

      {descriptor.params.length === 0 ? (
        <p className="text-xs text-gray-400">This plugin declares no automatable parameters.</p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {descriptor.params.map((param) => {
            const inputId = `wam2-${slotId}-${param.id}`;
            const value = values[param.id] ?? param.defaultValue;
            return (
              <li key={param.id} className="flex flex-col gap-1">
                <label htmlFor={inputId} className="text-xs text-gray-300">
                  {param.label}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={inputId}
                    type="range"
                    className="flex-1"
                    min={param.min}
                    max={param.max}
                    step={stepFor(param)}
                    value={value}
                    aria-valuetext={formatValue(param, value)}
                    onChange={(e) => setParam(param, Number(e.target.value))}
                  />
                  {/* Number input as well as the slider: a range input alone is
                      awkward for precise values with a keyboard or a screen reader. */}
                  <input
                    type="number"
                    className="w-20 rounded border border-gray-700 bg-gray-800 px-1 text-xs text-gray-100"
                    min={param.min}
                    max={param.max}
                    step={stepFor(param)}
                    value={drafts[param.id] ?? String(value)}
                    aria-label={`${param.label} value`}
                    onChange={(e) => {
                      const text = e.target.value;
                      setDrafts((prev) => ({ ...prev, [param.id]: text }));
                      const parsed = Number(text);
                      // Apply live only while the typed value is already legal;
                      // anything else waits for commit.
                      if (text !== '' && Number.isFinite(parsed) && parsed >= param.min && parsed <= param.max) {
                        setParam(param, parsed);
                      }
                    }}
                    onBlur={() => commitDraft(param)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitDraft(param);
                    }}
                  />
                  <button
                    type="button"
                    className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
                    onClick={() => addAutomationLane(param)}
                  >
                    Automate
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-gray-800 pt-2">
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`wam2-${slotId}-preset-name`} className="text-xs text-gray-300">
              Preset name
            </label>
            <input
              id={`wam2-${slotId}-preset-name`}
              type="text"
              className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
            onClick={onSavePreset}
          >
            Save preset
          </button>
        </div>

        {presets.length > 0 && (
          <ul aria-label="Saved presets" className="flex list-none flex-col gap-1 p-0">
            {presets.map((preset) => (
              <li key={preset.name} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate text-gray-300">{preset.name}</span>
                <button
                  type="button"
                  className="rounded border border-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-800"
                  onClick={() => onLoadPreset(preset)}
                >
                  Load
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-800"
                  onClick={() => onDeletePreset(preset)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Polite, and only for discrete actions — param drags do not write here. */}
      <p role="status" aria-live="polite" className="min-h-[1rem] text-xs text-gray-400">
        {status}
      </p>
    </section>
  );
};

export default Wam2GenericEditor;
