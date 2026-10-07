
export class SpatialRouter {
  private currentPan = 0;
  private currentWidth = 1.0;

  process(outputs: Float32Array[][], amount: number, isVowel: number, phonemeIndex: number, pVol: number): void {
    if (amount <= 0) {
       this.currentPan = 0;
       this.currentWidth = 1.0;
       return;
    }

    const outL = outputs[0][0];
    const outR = outputs[0][1];
    if (!outL || !outR) return;

    // Consonants get panned L/R deterministically.
    const isConsonant = 1.0 - isVowel;

    // Simple GLSL-style hash for pseudo-random deterministic direction (-1 or 1)
    const hash = Math.sin(phonemeIndex * 12.9898 + 78.233) * 43758.5453;
    const fract = hash - Math.floor(hash);
    const direction = fract > 0.5 ? 1 : -1;

    const panTarget = direction * isConsonant * amount;

    // Vowels get their stereo width modulated by intensity (pVol).
    // Louder vowels become wider.
    const widthTarget = isVowel > 0 ? 1.0 + (pVol * amount) : 1.0;

    for (let i = 0; i < outL.length; i++) {
      this.currentPan += 0.02 * (panTarget - this.currentPan);
      this.currentWidth += 0.02 * (widthTarget - this.currentWidth);

      const l = outL[i];
      const r = outR[i];

      // Mid/Side processing for width
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5 * this.currentWidth;

      let newL = mid + side;
      let newR = mid - side;

      // Equal power panning
      const angle = (this.currentPan + 1.0) * Math.PI * 0.25;
      const gainL = Math.cos(angle);
      const gainR = Math.sin(angle);

      // Normalize gain multipliers so center (0) is 1.0
      newL *= (Math.SQRT1_2 * 2 * gainL);
      newR *= (Math.SQRT1_2 * 2 * gainR);

      outL[i] = newL;
      outR[i] = newR;
    }
  }
}
