/**
 * Dev-only visual token review panel.
 * Open the app with `?visual-review=1` to compare panels side-by-side.
 */
import React, { memo } from 'react';
import { LedIndicator } from './PanelChrome';
import { RackPanelChrome } from './RackPanelChrome';
import { PanelTitleBar } from './PanelChrome';

export const VisualStyleShowcase = memo(() => (
  <div className="fixed inset-0 z-[200] overflow-y-auto bg-hyphon-deep p-6 font-mono text-gray-200">
    <h1 className="font-orbitron text-2xl text-cyan-400 tracking-widest mb-2">HYPHON VISUAL REVIEW</h1>
    <p className="text-xs text-gray-500 mb-8">Close tab or remove <code>?visual-review=1</code> from the URL.</p>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl">
      {/* Panel shells */}
      <section>
        <h2 className="hyphon-section-label text-cyan-500/80 mb-3">Panel shells</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="hyphon-chrome-panel h-32 p-4 relative">
            <RackPanelChrome vents />
            <PanelTitleBar title="Part A" />
            <span className="absolute bottom-3 left-4 text-[9px] text-gray-500">hyphon-chrome-panel</span>
          </div>
          <div className="hyphon-rack-shell h-32 p-4 relative">
            <span className="absolute bottom-3 left-4 text-[9px] text-gray-500">hyphon-rack-shell</span>
          </div>
          <div className="hyphon-sequencer-shell h-32 p-4 relative col-span-2">
            <RackPanelChrome stickyScrews />
            <span className="absolute bottom-3 left-4 text-[9px] text-gray-500">hyphon-sequencer-shell</span>
          </div>
        </div>
      </section>

      {/* LEDs */}
      <section>
        <h2 className="hyphon-section-label text-cyan-500/80 mb-3">LED indicators</h2>
        <div className="hyphon-inset-well p-4 flex flex-wrap gap-4 items-center">
          <LedIndicator color="off" aria-label="off" />
          <LedIndicator color="cyan" pulse aria-label="cyan pulse" />
          <LedIndicator color="green" aria-label="green" />
          <LedIndicator color="red" pulse aria-label="red pulse" />
          <LedIndicator color="yellow" aria-label="yellow" />
          <LedIndicator color="purple" aria-label="purple" />
        </div>
      </section>

      {/* Buttons */}
      <section>
        <h2 className="hyphon-section-label text-cyan-500/80 mb-3">Toolbar buttons</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="hyphon-btn hyphon-btn--ghost px-4 py-2 text-xs">Ghost</button>
          <button type="button" className="hyphon-btn hyphon-btn--accent-cyan px-4 py-2 text-xs">Accent</button>
          <button type="button" className="hyphon-btn hyphon-btn--accent-active px-4 py-2 text-xs">Active</button>
        </div>
      </section>

      {/* Legacy panels */}
      <section>
        <h2 className="hyphon-section-label text-cyan-500/80 mb-3">Legacy module panels</h2>
        <div className="space-y-3">
          <div className="hyphon-legacy-panel hyphon-legacy-panel--cyan h-16 flex items-center px-4 text-cyan-400 font-orbitron text-sm">Synth A</div>
          <div className="hyphon-legacy-panel hyphon-legacy-panel--pink h-16 flex items-center px-4 text-pink-400 font-orbitron text-sm">Synth B</div>
          <div className="hyphon-legacy-panel hyphon-legacy-panel--yellow h-16 flex items-center px-4 text-yellow-400 font-orbitron text-sm">Drums</div>
        </div>
      </section>

      {/* Knob material swatch */}
      <section className="lg:col-span-2">
        <h2 className="hyphon-section-label text-cyan-500/80 mb-3">Knob material tokens</h2>
        <div className="flex gap-4 flex-wrap">
          {[
            ['--hyphon-knob-bg', 'Body'],
            ['--hyphon-knob-ring', 'Ring'],
            ['--hyphon-knob-arc-min', 'Arc min'],
            ['--hyphon-knob-arc-max', 'Arc max'],
            ['--hyphon-knob-needle', 'Needle'],
          ].map(([token, label]) => (
            <div key={token} className="flex flex-col items-center gap-1">
              <div
                className="w-12 h-12 rounded-full border border-gray-700 shadow-hyphon-panel"
                style={{ background: `var(${token})` }}
              />
              <span className="text-[9px] text-gray-500">{label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  </div>
));

VisualStyleShowcase.displayName = 'VisualStyleShowcase';
