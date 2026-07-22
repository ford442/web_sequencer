/**
 * Pure math helpers for stem export validation (no audio engine imports).
 */
export function measureMasterStemDeviation(
    master: AudioBuffer,
    stems: AudioBuffer[],
): number {
    const len = master.length;
    let masterSq = 0;
    let sumSq = 0;

    const masterL = master.getChannelData(0);
    for (let i = 0; i < len; i++) {
        masterSq += masterL[i] * masterL[i];
    }

    const mixed = new Float32Array(len);
    for (const stem of stems) {
        const ch = stem.getChannelData(0);
        for (let i = 0; i < len; i++) {
            mixed[i] += ch[i];
        }
    }
    for (let i = 0; i < len; i++) {
        sumSq += mixed[i] * mixed[i];
    }

    const masterRms = Math.sqrt(masterSq / len);
    const sumRms = Math.sqrt(sumSq / len);
    if (sumRms === 0) return masterRms === 0 ? 0 : 1;
    return Math.abs(masterRms - sumRms) / sumRms;
}
