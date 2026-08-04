export const triggerSidechainDuck = (
  audioCtx: AudioContext,
  sidechainGainNode: BiquadFilterNode,
  time: number,
  depth: number = -24, // How quiet it gets in dB
  releaseTime: number = 0.25, // How long it takes to recover (in seconds)
) => {
  const gain = sidechainGainNode.gain;

  // 1. Cancel any previous automations overlapping this new trigger
  gain.cancelScheduledValues(time);

  // 2. Anchor the value right before the drop
  gain.setValueAtTime(gain.value, time);

  // 3. The Attack: Drop the gain instantly (10ms to prevent clicking)
  gain.linearRampToValueAtTime(depth, time + 0.01);

  // 4. The Release: Return to 0 dB
  // We cannot use exponentialRampToValueAtTime with 0.0, and since we are using dB
  // for a BiquadFilterNode, we can just use setTargetAtTime or linearRampToValueAtTime.
  // setTargetAtTime creates a nice exponential-style decay back to 0.
  gain.setTargetAtTime(0.0, time + 0.01, releaseTime / 3);
};

export const triggerBassEQDuck = (
  audioCtx: AudioContext,
  eqNode: BiquadFilterNode | null,
  time: number,
  duration: number,
  depthDb: number = -6,
) => {
  if (!eqNode) return;

  const gain = eqNode.gain;

  // 1. Cancel any previous automations
  gain.cancelScheduledValues(time);

  // 2. Anchor the value
  gain.setValueAtTime(gain.value, time);

  // 3. The Attack: Drop the gain instantly (10ms to prevent clicking)
  gain.linearRampToValueAtTime(depthDb, time + 0.01);

  // 4. Hold the duck for the duration of the note
  gain.setValueAtTime(depthDb, time + duration);

  // 5. Release back to 0 dB
  gain.linearRampToValueAtTime(0.0, time + duration + 0.1);
};
