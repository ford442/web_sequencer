/**
 * Chassis materials review (#1581 knobs, #1583 panel art, #1587 icons, #1589
 * tokens) for `?visual-review=1`. Each knob row shows the default material
 * next to its cap material: KNOB_MATERIAL_CAP_DARK on the dark surface and
 * KNOB_MATERIAL_CHASSIS on the white one.
 */
import React, { memo, useState } from 'react';
import { HardwareKnob } from '../HardwareKnob';
import { KNOB_MATERIAL, KNOB_MATERIAL_CAP_DARK, KNOB_MATERIAL_CHASSIS, type KnobMaterial } from '../knobMaterial';
import { OscillatorPanelArt } from '../chassis/OscillatorPanelArt';
import { OscillatorSignatureIcon } from '../chassis/OscillatorSignatureIcon';
import { OSCILLATOR_THEMES } from '../oscillatorThemes';
import type { OscillatorType } from '../../types';

const OSC_TYPES = Object.keys(OSCILLATOR_THEMES) as OscillatorType[];

const TOKENS: Array<[string, string]> = [
    ['--chassis-body', 'Body'],
    ['--chassis-body-lo', 'Body lo'],
    ['--chassis-well', 'Well'],
    ['--chassis-print', 'Print'],
    ['--chassis-print-muted', 'Print muted'],
    ['--key-white', 'Key'],
    ['--key-led', 'LED'],
];

const KnobRow = memo(({ material, label }: { material: KnobMaterial; label: string }) => {
    const [values, setValues] = useState([0.15, 0.5, 0.85]);
    return (
        <div className="flex flex-col gap-2">
            <span className="text-[9px] uppercase tracking-widest opacity-70">{label}</span>
            <div className="flex items-end gap-4 flex-wrap">
                {values.map((v, i) => (
                    <HardwareKnob
                        key={`classic-${i}`}
                        mode="classic"
                        label={`Classic ${i + 1}`}
                        value={v}
                        min={0}
                        max={1}
                        material={material}
                        onChange={(next) => setValues((prev) => prev.map((p, j) => (j === i ? next : p)))}
                    />
                ))}
                <HardwareKnob
                    mode="holographic"
                    label="Canvas"
                    value={values[1]}
                    min={0}
                    max={1}
                    size={72}
                    material={material}
                    onChange={(next) => setValues((prev) => [prev[0], next, prev[2]])}
                />
            </div>
        </div>
    );
});

KnobRow.displayName = 'KnobRow';

export const ChassisMaterialsShowcase = memo(() => (
    <>
        <section className="lg:col-span-2" data-testid="chassis-knob-showcase">
            <h2 className="hyphon-section-label text-cyan-500/80 mb-3">Knob caps — before / after (#1581)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="hyphon-chrome-panel p-4 space-y-4" data-surface="dark">
                    <KnobRow material={KNOB_MATERIAL} label="Dark · KNOB_MATERIAL" />
                    <KnobRow material={KNOB_MATERIAL_CAP_DARK} label="Dark · KNOB_MATERIAL_CAP_DARK" />
                </div>
                <div data-chassis="white" className="chassis-body p-6 space-y-4" data-surface="light" data-testid="chassis-white-surface">
                    <span className="chassis-label">White chassis</span>
                    <div className="chassis-print-rule" />
                    <KnobRow material={KNOB_MATERIAL} label="Light · KNOB_MATERIAL" />
                    <KnobRow material={KNOB_MATERIAL_CHASSIS} label="Light · KNOB_MATERIAL_CHASSIS" />
                </div>
            </div>
        </section>

        <section className="lg:col-span-2" data-testid="chassis-art-showcase">
            <h2 className="hyphon-section-label text-cyan-500/80 mb-3">Oscillator panel art + signature icons (#1583 / #1587)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {OSC_TYPES.map((t) => (
                    <figure key={t} className="flex flex-col gap-1">
                        <OscillatorPanelArt type={t} height={88} />
                        <figcaption className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wider ${OSCILLATOR_THEMES[t].text}`}>
                            <OscillatorSignatureIcon type={t} title={`${OSCILLATOR_THEMES[t].label} oscillator`} className="w-4 h-4" />
                            {OSCILLATOR_THEMES[t].label}
                        </figcaption>
                    </figure>
                ))}
            </div>
        </section>

        <section className="lg:col-span-2">
            <h2 className="hyphon-section-label text-cyan-500/80 mb-3">White-chassis tokens (#1589)</h2>
            <div data-chassis="white" className="chassis-body p-5 flex gap-4 flex-wrap items-end">
                {TOKENS.map(([token, label]) => (
                    <div key={token} className="flex flex-col items-center gap-1">
                        <div className="w-10 h-10 rounded-full border border-black/10" style={{ background: `var(${token})` }} />
                        <span className="chassis-label">{label}</span>
                    </div>
                ))}
            </div>
        </section>
    </>
));

ChassisMaterialsShowcase.displayName = 'ChassisMaterialsShowcase';
