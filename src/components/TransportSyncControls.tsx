import React, { memo } from 'react';
import type { TransportSyncMode } from '../midi/clock/types';
import { transportSyncStore, syncStateLabel, useTransportSyncStore } from '../stores/transportSyncStore';

const MODES: { id: TransportSyncMode; label: string; title: string }[] = [
  { id: 'internal', label: 'INT', title: 'Internal clock (default)' },
  { id: 'master', label: 'MSTR', title: 'MIDI clock master — send Start/Stop/Clock to output' },
  { id: 'slave', label: 'SLV', title: 'MIDI clock slave — follow external clock (swing ignored)' },
];

export const TransportSyncControls = memo(function TransportSyncControls() {
  const { mode, inputDeviceId, outputDeviceId, telemetry, inputs, outputs } =
    useTransportSyncStore();

  const showInput = mode === 'slave';
  const showOutput = mode === 'master';

  return (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label="Transport sync"
    >
      <span className="text-[9px] text-gray-500 font-mono uppercase tracking-wider hidden lg:inline">
        SYNC
      </span>
      <div className="flex items-center bg-zinc-950 rounded-md border border-zinc-800">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.title}
            aria-pressed={mode === m.id}
            onClick={() => transportSyncStore.setMode(m.id)}
            className={`h-7 px-1.5 text-[9px] font-bold font-mono transition-colors ${
              mode === m.id
                ? 'bg-cyan-900/60 text-cyan-200'
                : 'text-gray-500 hover:text-cyan-400'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {showOutput && (
        <select
          aria-label="MIDI clock output device"
          value={outputDeviceId ?? ''}
          onChange={(e) =>
            transportSyncStore.setOutputDevice(e.target.value || null)
          }
          className="h-7 max-w-[120px] text-[9px] bg-zinc-950 border border-zinc-800 rounded-md text-cyan-200 px-1"
        >
          <option value="">Output…</option>
          {outputs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}

      {showInput && (
        <select
          aria-label="MIDI clock input device"
          value={inputDeviceId ?? ''}
          onChange={(e) =>
            transportSyncStore.setInputDevice(e.target.value || null)
          }
          className="h-7 max-w-[120px] text-[9px] bg-zinc-950 border border-zinc-800 rounded-md text-cyan-200 px-1"
        >
          <option value="">Input…</option>
          {inputs.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      )}

      {mode !== 'internal' && (
        <span
          className="text-[8px] font-mono uppercase text-amber-400/90 hidden md:inline"
          role="status"
          title={`Sync: ${syncStateLabel(telemetry.state)}`}
        >
          {syncStateLabel(telemetry.state)}
        </span>
      )}
    </div>
  );
});
