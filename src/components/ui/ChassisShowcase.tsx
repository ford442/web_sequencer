/**
 * Expandable hardware chassis review (#1580) for `?visual-review=1`.
 * The demo panels are showcase-only stand-ins that exercise each mode's
 * footprint; the live layout hosts the real rack via `?chassis=white`.
 *
 * Stand-in panels use HardwareKnob (same cap renderer + material as the rack)
 * on a real `hyphon-rack-surface` plate. Importing HardwareModule here would
 * make Rolldown regroup the entry chunk (+47 KB raw) for a dev-only view.
 */
import React, { memo, useEffect, useState } from 'react';
import { HardwareKnob } from '../HardwareKnob';
import { KNOB_MATERIAL_CHASSIS } from '../knobMaterial';
import { LiveKeyboard } from '../LiveKeyboard';
import { PanelTitleBar } from './PanelChrome';
import { RackPanelChrome } from './RackPanelChrome';
import { HardwareChassis } from '../chassis/HardwareChassis';
import { ChassisLedStrip } from '../chassis/ChassisLedStrip';
import { OscillatorPanelArt } from '../chassis/OscillatorPanelArt';
import { OscillatorSignatureIcon } from '../chassis/OscillatorSignatureIcon';
import { CHASSIS_MODE_ORDER, CHASSIS_MODES, type ChassisMode } from '../chassis/chassisModes';
import { OSCILLATOR_THEMES } from '../oscillatorThemes';
import type { OscillatorType } from '../../types';

type KnobSpec = [id: string, label: string, x: number, y: number];

interface DemoPanel {
    title: string;
    color: [number, number, number];
    knobs: KnobSpec[];
}

const DEMO_PANELS: Record<ChassisMode, DemoPanel> = {
    osc: {
        title: 'SYNTH A // LEAD',
        color: [0.13, 0.83, 0.93],
        knobs: [['cutoff', 'CUTOFF', 0.11, 0.38], ['reso', 'RESO', 0.26, 0.38], ['env', 'ENV MOD', 0.41, 0.38],
            ['decay', 'DECAY', 0.11, 0.74], ['accent', 'ACCENT', 0.26, 0.74], ['glide', 'GLIDE', 0.41, 0.74]],
    },
    drm: {
        title: 'KICK DRUM',
        color: [0.98, 0.45, 0.09],
        knobs: [['tune', 'TUNE', 0.16, 0.55], ['decay', 'DECAY', 0.38, 0.55], ['punch', 'PUNCH', 0.6, 0.55], ['drive', 'DRIVE', 0.82, 0.55]],
    },
    smp: {
        title: 'SAMPLER // BANK 1',
        color: [0.66, 0.33, 0.97],
        knobs: [['start', 'START', 0.12, 0.7], ['end', 'END', 0.3, 0.7], ['pitch', 'PITCH', 0.48, 0.7],
            ['filter', 'FILTER', 0.66, 0.7], ['attack', 'ATTACK', 0.84, 0.7]],
    },
    tts: {
        title: 'VOICE // TTS',
        color: [0.96, 0.45, 0.71],
        knobs: [['speed', 'SPEED', 0.2, 0.74], ['pitch', 'PITCH', 0.4, 0.74], ['formant', 'FORMANT', 0.6, 0.74], ['crush', 'CRUSH', 0.8, 0.74]],
    },
    vd: {
        title: 'VOICE DESIGNER',
        color: [0.13, 0.83, 0.93],
        knobs: [['mirror', 'MIRROR', 0.86, 0.32], ['shift', 'SHIFT', 0.86, 0.72]],
    },
    pcf: {
        title: 'PCF // FILTER',
        color: [0.92, 0.7, 0.03],
        knobs: [['cutoff', 'CUTOFF', 0.2, 0.55], ['res', 'RES', 0.4, 0.55], ['drive', 'DRIVE', 0.6, 0.55], ['mode', 'MODE', 0.8, 0.55]],
    },
};

const DEMO_PATTERN: readonly boolean[] = Array.from({ length: 32 }, (_, i) => i % 4 === 0 || i === 6 || i === 14 || i === 27);
const OSC_TYPES = Object.keys(OSCILLATOR_THEMES) as OscillatorType[];
const noop = () => undefined;

/** Deterministic spectral heat map for the Voice Designer stand-in. */
const HEATMAP = Array.from({ length: 12 * 32 }, (_, i) => {
    const x = i % 32;
    const y = Math.floor(i / 32);
    const v = 0.5 + 0.5 * Math.sin(x * 0.45 + y * 0.9) * Math.cos(y * 0.35 - x * 0.12);
    return `hsl(${200 - v * 190} 85% ${18 + v * 42}%)`;
});

const StageExtras = memo(({ mode, osc, onOsc }: { mode: ChassisMode; osc: OscillatorType; onOsc: (t: OscillatorType) => void }) => {
    if (mode === 'osc') {
        return (
            <div className="absolute top-10 right-5 w-[38%] min-w-[220px] flex flex-col gap-2 pointer-events-auto">
                <OscillatorPanelArt type={osc} height={104} />
                <div className="grid grid-cols-5 gap-1 p-1.5 rounded-lg bg-zinc-950/85" role="group" aria-label="Oscillator family">
                    {OSC_TYPES.map((t) => (
                        <button
                            key={t}
                            type="button"
                            aria-pressed={t === osc}
                            title={OSCILLATOR_THEMES[t].label}
                            onClick={() => onOsc(t)}
                            className={`flex flex-col items-center gap-0.5 rounded px-1 py-1 text-[7px] font-bold tracking-wider border ${t === osc ? `bg-zinc-800 border-zinc-500 ${OSCILLATOR_THEMES[t].text}` : 'border-transparent text-zinc-500 hover:text-zinc-200'}`}
                        >
                            <OscillatorSignatureIcon type={t} className="w-4 h-4" />
                            {OSCILLATOR_THEMES[t].badge}
                        </button>
                    ))}
                </div>
            </div>
        );
    }
    if (mode === 'smp' || mode === 'tts') {
        return (
            <div className="absolute top-10 left-6 right-6 h-[34%] rounded-lg bg-[#0e1a14] shadow-inner p-3 font-mono text-[11px] text-emerald-300 overflow-hidden">
                {mode === 'tts'
                    ? <span>&gt; THE MACHINE SINGS IN THIRTY-TWO STEPS_</span>
                    : (
                        <svg viewBox="0 0 320 60" preserveAspectRatio="none" className="w-full h-full" aria-hidden="true">
                            <path
                                d={`M0 30 ${Array.from({ length: 80 }, (_, i) => `L${i * 4} ${30 + Math.sin(i * 0.7) * 22 * Math.exp(-i / 40)}`).join(' ')}`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                            />
                        </svg>
                    )}
            </div>
        );
    }
    if (mode === 'vd') {
        return (
            <div className="absolute top-10 left-6 right-[24%] bottom-6 grid gap-px rounded-lg overflow-hidden bg-black" style={{ gridTemplateColumns: 'repeat(32, 1fr)' }} aria-hidden="true">
                {HEATMAP.map((c, i) => <span key={i} style={{ background: c }} />)}
            </div>
        );
    }
    return null;
});

StageExtras.displayName = 'StageExtras';

interface DemoRackPanelProps {
    mode: ChassisMode;
    values: Record<string, number>;
    onChange: (key: string, value: number) => void;
    children: React.ReactNode;
}

/** A rack plate like HardwareModule's: title bar, screws, absolutely placed knobs. */
const DemoRackPanel = memo(({ mode, values, onChange, children }: DemoRackPanelProps) => {
    const panel = DEMO_PANELS[mode];
    return (
        <div className="relative w-full h-full hyphon-chrome-panel hyphon-rack-surface overflow-hidden">
            <RackPanelChrome vents />
            <PanelTitleBar title={panel.title} />
            {panel.knobs.map(([id, label, x, y], i) => {
                const key = `${mode}:${id}`;
                return (
                    <div
                        key={key}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                    >
                        <HardwareKnob
                            mode="holographic"
                            size={mode === 'vd' ? 64 : 72}
                            label={label}
                            value={values[key] ?? (0.2 + ((i * 0.17) % 0.7))}
                            min={0}
                            max={1}
                            colorHex={panel.color}
                            material={KNOB_MATERIAL_CHASSIS}
                            onChange={(v) => onChange(key, v)}
                        />
                    </div>
                );
            })}
            {children}
        </div>
    );
});

DemoRackPanel.displayName = 'DemoRackPanel';

export const ChassisShowcase = memo(() => {
    const [mode, setMode] = useState<ChassisMode>('osc');
    const [osc, setOsc] = useState<OscillatorType>('javascript');
    const [values, setValues] = useState<Record<string, number>>({});
    const [running, setRunning] = useState(false);
    const [playhead, setPlayhead] = useState(4);

    useEffect(() => {
        if (!running) return;
        const id = window.setInterval(() => setPlayhead((p) => (p + 1) % 32), 125);
        return () => window.clearInterval(id);
    }, [running]);

    const onKnobChange = (key: string, value: number) => setValues((prev) => ({ ...prev, [key]: value }));

    return (
        <section className="lg:col-span-2" data-testid="chassis-showcase">
            <h2 className="hyphon-section-label text-cyan-500/80 mb-3">Expandable hardware chassis (#1580)</h2>
            <p className="text-[10px] text-gray-500 mb-3">
                Mode keys morph the stage height and body width; the LED strip and key bed stay put.
                Live layout: <code>?chassis=white</code>.
                {' '}
                <button type="button" className="hyphon-btn hyphon-btn--ghost px-2 py-0.5 text-[10px]" aria-pressed={running} onClick={() => setRunning((r) => !r)}>
                    {running ? 'Stop playhead' : 'Run playhead'}
                </button>
            </p>
            <HardwareChassis
                mode={mode}
                modes={CHASSIS_MODE_ORDER}
                onModeChange={setMode}
                badgeDetail={mode === 'osc' ? OSCILLATOR_THEMES[osc].label : CHASSIS_MODES[mode].label}
                badgeIcon={mode === 'osc' ? <OscillatorSignatureIcon type={osc} className="hyphon-chassis__badge-icon" /> : undefined}
                ledStrip={<ChassisLedStrip steps={DEMO_PATTERN} playhead={playhead} accent="#ff3b3b" showNumbers />}
                keybed={(
                    <>
                        <span className="chassis-label hyphon-chassis__keybed-label">Key bed</span>
                        <LiveKeyboard onPlayNote={noop} onStopNote={noop} activeTrackColor="#ff3b3b" />
                    </>
                )}
            >
                <DemoRackPanel mode={mode} values={values} onChange={onKnobChange}>
                    <StageExtras mode={mode} osc={osc} onOsc={setOsc} />
                </DemoRackPanel>
            </HardwareChassis>
        </section>
    );
});

ChassisShowcase.displayName = 'ChassisShowcase';
