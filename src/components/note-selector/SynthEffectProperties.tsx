import React from "react";
import { SynthGranularEffects } from "./SynthGranularEffects";
import { SynthModulationEffects } from "./SynthModulationEffects";
import { SynthSpectralEffects } from "./SynthSpectralEffects";
export type { SynthEffectPropertiesProps } from "./synthEffectTypes";

export { SynthGranularEffects } from "./SynthGranularEffects";

export const SynthEffectProperties: React.FC<import("./synthEffectTypes").SynthEffectPropertiesProps> = React.memo((props) => (
  <>
    <SynthModulationEffects {...props} />
    <SynthSpectralEffects {...props} />
  </>
));
