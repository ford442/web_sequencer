const fs = require('fs');
let content = fs.readFileSync('src/components/WaveformDisplay.tsx', 'utf-8');
const searchStr = "\nimport React, { useRef, useEffect, memo } from 'react';\nimport type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';";

let idx = content.indexOf(searchStr);
if (idx > -1) {
  content = content.substring(0, idx) + "\n});\n";
  fs.writeFileSync('src/components/WaveformDisplay.tsx', content);
  console.log("Fixed.");
} else {
  console.log("Not found.");
}
