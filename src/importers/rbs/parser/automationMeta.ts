export function getAutomationDisplayName(parameter: string): string {
  const names: Record<string, string> = {
    tempo: 'Tempo',
    swing: 'Swing',
    tb303Acutoff: 'TB-303 A Cutoff',
    tb303Bcutoff: 'TB-303 B Cutoff',
    pcfCutoff: 'PCF Cutoff',
    masterVolume: 'Master Volume',
    tb303Aresonance: 'TB-303 A Resonance',
    tb303Bresonance: 'TB-303 B Resonance',
    tb303Adecay: 'TB-303 A Decay',
    tb303Bdecay: 'TB-303 B Decay',
    pcfResonance: 'PCF Resonance',
    pcfEnvAmount: 'PCF Env Amount',
  };
  return names[parameter] || parameter;
}

export function getAutomationRange(parameter: string): [number, number] {
  const ranges: Record<string, [number, number]> = {
    tempo: [40, 250],
    swing: [0, 100],
    tb303Acutoff: [0, 127],
    tb303Bcutoff: [0, 127],
    pcfCutoff: [0, 127],
    masterVolume: [0, 127],
    tb303Aresonance: [0, 127],
    tb303Bresonance: [0, 127],
    tb303Adecay: [0, 127],
    tb303Bdecay: [0, 127],
    pcfResonance: [0, 127],
    pcfEnvAmount: [0, 127],
  };
  return ranges[parameter] || [0, 127];
}
