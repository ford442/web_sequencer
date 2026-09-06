export const TTS_ALIGNMENT_FIXTURE = {
  transcript: 'ah ee',
  sampleRate: 16000,
  /** Hand labels: AH 0–400ms, IY 400–900ms, tail silence. */
  expectedBoundariesSec: [0, 0.4, 0.9] as const,
};

/** Deterministic two-vowel stand-in for a short English TTS take. */
export function generateTtsFixtureAudio(): Float32Array {
  const { sampleRate, expectedBoundariesSec } = TTS_ALIGNMENT_FIXTURE;
  const duration = 1;
  const audio = new Float32Array(sampleRate * duration);
  const b0 = expectedBoundariesSec[0];
  const b1 = expectedBoundariesSec[1];
  const b2 = expectedBoundariesSec[2];
  for (let i = 0; i < audio.length; i++) {
    const t = i / sampleRate;
    if (t >= b0 && t < b1) {
      audio[i] = 0.4 * Math.sin(2 * Math.PI * 220 * t);
    } else if (t >= b1 && t < b2) {
      audio[i] = 0.4 * Math.sin(2 * Math.PI * 330 * t);
    }
  }
  return audio;
}
