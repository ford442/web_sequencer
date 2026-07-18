import fs from 'fs';

let content = fs.readFileSync('src/hooks/audioEngine/audioPlayback.ts', 'utf8');

content = content.replace(
  /\/\/\s*Hoist expensive WASM parameter mappings to avoid cross-boundary calls in retrigger loop\n\s*if \(\n\s*track === "partB"/,
  `// Hoist expensive WASM parameter mappings to avoid cross-boundary calls in retrigger loop
    if (track === "bass2") {
      if (refs.open303ManagerRef.current?.isBass2Ready()) {
        refs.open303ManagerRef.current.applyBass2Params(effectiveParams as any);
      }
    }
    if (
      track === "partB"`
);

fs.writeFileSync('src/hooks/audioEngine/audioPlayback.ts', content, 'utf8');
