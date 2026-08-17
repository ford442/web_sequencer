export interface ShortcutSection {
  title: string;
  items: { key: string; desc: string }[];
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Global',
    items: [
      { key: '?', desc: 'Open Help (shortcuts, guides, search)' },
      { key: 'Space', desc: 'Play / Stop' },
      { key: 'Ctrl + C', desc: 'Copy Selection' },
      { key: 'Ctrl + V', desc: 'Paste Selection' },
      { key: 'Delete', desc: 'Clear Selection / Reset Knobs' },
    ],
  },
  {
    title: 'Sequencer',
    items: [
      { key: 'Click', desc: 'Toggle Step' },
      { key: 'Shift + Click', desc: 'Select Range / Edit Length' },
      { key: 'Alt + Click', desc: 'Toggle Slide (Gliss)' },
      { key: 'Ctrl + Click', desc: 'Toggle Chord (Major/Minor)' },
      { key: 'Right Click', desc: 'Note Properties Menu' },
    ],
  },
  {
    title: 'Knobs & Controls',
    items: [
      { key: 'Drag', desc: 'Adjust Value' },
      { key: 'Alt + Drag', desc: 'Nudge automation point at playhead (automated knobs)' },
      { key: 'Arrows', desc: 'Fine Tune Value' },
      { key: 'Shift + Arrows', desc: 'Coarse Tune Value' },
      { key: 'Double Click', desc: 'Reset to Default' },
      { key: 'AUTO / AUTO VIEW', desc: 'Toggle automation curve ghost on hardware knobs' },
      { key: 'Right-click knob', desc: 'Enable/disable or clear automation lane' },
    ],
  },
  {
    title: 'MIDI Controllers',
    items: [
      { key: 'MIDI (toolbar)', desc: 'Toggle MIDI Learn mode' },
      { key: 'MAP', desc: 'Open MIDI mapping panel — view / clear bindings' },
      { key: 'Touch knob', desc: 'While learning: select target parameter' },
      { key: 'Long-press knob', desc: 'Start MIDI Learn for that parameter' },
      { key: 'Right-click master slider', desc: 'MIDI Learn for volume / pan / warmth' },
      { key: 'Right-click session cell', desc: 'MIDI Learn for clip / scene launch' },
      { key: 'Move CC / note', desc: 'While learning: bind controller to last-touched control' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { key: 'Tab', desc: 'Focus Next Element' },
      { key: 'Shift + Tab', desc: 'Focus Previous Element' },
      { key: 'CLIP (toolbar)', desc: 'Open Session / clip launcher' },
      { key: 'Arrows (Session)', desc: 'Move clip/scene focus' },
      { key: 'Enter / Space (Session)', desc: 'Launch focused clip or scene' },
      { key: 'Delete (Session)', desc: 'Stop focused track (or all from a scene cell)' },
      { key: 'Gamepad Attack / Jump', desc: 'Launch clip / scene when Session is focused' },
    ],
  },
];
