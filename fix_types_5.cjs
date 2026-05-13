const fs = require('fs');

let typesCode = fs.readFileSync('src/types.ts', 'utf8');

if (!typesCode.includes('pitchAttack')) {
  typesCode = typesCode.replace(/  attack: number;/g, '  pitchAttack: number;');
  typesCode = typesCode.replace(/  decay: number;/g, '  pitchDecay: number;');
}
fs.writeFileSync('src/types.ts', typesCode);
