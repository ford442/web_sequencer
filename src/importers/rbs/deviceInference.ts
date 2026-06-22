/**
 * Infer which ReBirth devices are present from parsed raw data.
 */

import type { RawRbsData, RbsDeviceId, Tb303PatternA, Tb303PatternB, DrumPattern } from './types';

export function isTb303PatternSilent(pattern: Tb303PatternA | Tb303PatternB): boolean {
  return pattern.steps.every((s) => s.note < 0);
}

function drumPatternHasTriggers(pattern: DrumPattern): boolean {
  return (
    pattern.kick.some(Boolean) ||
    pattern.snare.some(Boolean) ||
    pattern.closedHat.some(Boolean) ||
    pattern.openHat.some(Boolean)
  );
}

function drumBankHasTriggers(patterns: DrumPattern[]): boolean {
  return patterns.some(drumPatternHasTriggers);
}

export { drumBankHasTriggers };

/** Infer device list from DEVL banks and/or legacy single-pattern data. */
export function inferDevicesPresent(
  raw: Pick<RawRbsData, 'tb303PatternA' | 'tb303PatternB' | 'drums' | 'songData'>,
): RbsDeviceId[] {
  const devices: RbsDeviceId[] = [];
  const banks = raw.songData?.patternBanks;

  const has303A = (banks?.tb303A.length ?? 0) > 0 || !isTb303PatternSilent(raw.tb303PatternA);
  const has303B = (banks?.tb303B.length ?? 0) > 0 || !isTb303PatternSilent(raw.tb303PatternB);

  if (has303A) devices.push('303-1');
  if (has303B) devices.push('303-2');

  if (banks) {
    if (drumBankHasTriggers(banks.drums808)) devices.push('808');
    if (drumBankHasTriggers(banks.drums909)) devices.push('909');
  } else if (drumPatternHasTriggers(raw.drums)) {
    devices.push(raw.drums.kitType === '808' ? '808' : '909');
  } else if (raw.drums.kitType === '808') {
    devices.push('808');
  }

  return devices;
}
