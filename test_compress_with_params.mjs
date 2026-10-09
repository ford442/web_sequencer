import fs from 'fs';
import { execSync } from 'child_process';

const code = fs.readFileSync('src/audio-worklets/rubberband/spectralEffects.ts', 'utf8');

const tscOut = execSync('npx tsc --target ES2022 --module CommonJS src/audio-worklets/rubberband/spectralEffects.ts');
