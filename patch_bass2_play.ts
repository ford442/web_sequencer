import fs from 'fs';

let content = fs.readFileSync('src/hooks/audioEngine/audioPlayback.ts', 'utf8');

content = content.replace(
  /if \(track === "bass2"\) \{\n\s*if \(refs\.open303ManagerRef\.current\?\.isBass2Ready\(\)\) \{\n\s*const midi = noteToMidi\(note\);\n\s*triggerBassEQDuck\(\n\s*context,\n\s*refs\.bassSidechainEQBusRef\.current,\n\s*now,\n\s*0\.25,\n\s*\); \/\/ Approximate duration for interactive play\n\s*const t0 = performance\.now\(\);\n\s*refs\.open303ManagerRef\.current\.setBass2Drive\(params\.drive \|\| 0\);\n\s*refs\.open303ManagerRef\.current\.noteOnBass2\(midi, 100\);/g,
  `if (track === "bass2") {
      if (refs.open303ManagerRef.current?.isBass2Ready()) {
        refs.open303ManagerRef.current.applyBass2Params(params as any);
        const midi = noteToMidi(note);
        triggerBassEQDuck(
          context,
          refs.bassSidechainEQBusRef.current,
          now,
          0.25,
        ); // Approximate duration for interactive play
        const t0 = performance.now();
        refs.open303ManagerRef.current.setBass2Drive(params.drive || 0);
        refs.open303ManagerRef.current.noteOnBass2(midi, 100);`
);

fs.writeFileSync('src/hooks/audioEngine/audioPlayback.ts', content, 'utf8');
