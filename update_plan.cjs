const fs = require('fs');

let plan = fs.readFileSync('agent_plan.md', 'utf-8');

// mark item as done
plan = plan.replace(
    /- \[ \] \*\*Idea:\*\* "Multiband Distortion for TTS"/,
    '- [x] **Idea:** "Multiband Distortion for TTS"'
);
plan = plan.replace(
    /\* \*\*Idea:\*\* "Multiband Distortion for TTS"/,
    '* [x] **Idea:** "Multiband Distortion for TTS"'
);

// add to changelog
const today = new Date().toISOString().split('T')[0];
const newLog = `* [${today}] - Implemented Multiband Distortion for TTS: Updated \`vocal-overdrive-processor.ts\` to use a 1-pole lowpass crossover filter. The overdrive is now only applied to the high-frequency band, keeping the fundamental pitch clean while adding aggressive harmonics to the high end. Fulfills the "Multiband Distortion for TTS" Innovation Lab idea. Added new idea: "Dynamic Multi-band Compression".\n`;

const logIndex = plan.indexOf('## 📜 Changelog\n');
if (logIndex !== -1) {
    plan = plan.slice(0, logIndex + 16) + newLog + plan.slice(logIndex + 16);
}

// add new idea
const ideaIndex = plan.indexOf('## 🧠 Innovation Lab');
if (ideaIndex !== -1) {
    plan = plan.slice(0, ideaIndex + 25) + "\n* **Idea:** \"Dynamic Multi-band Compression\" - Allow multi-band compression for fine-tuned vocal dynamic control.\n" + plan.slice(ideaIndex + 25);
}

fs.writeFileSync('agent_plan.md', plan);
