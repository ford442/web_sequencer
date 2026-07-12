import {
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_BASS2_PARAMS,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
    DEFAULT_SAMPLER_BANK_PARAMS,
} from '../../constants'
import type { AutomationTarget } from '../../types'
import {
    getBass2Controls, getSynthControls, getKickControls, getSnareControls,
    getClosedHatControls, getOpenHatControls, getSamplerControls,
} from '../../utils/knobConfigs'

// Programmatically derived from the knobConfig getters so it never drifts from the real control lists.
// Used by the global "REC AUTO" effect to arm all params when automation recording is active.
export const GLOBAL_ARM_PARAMS: Array<{ target: AutomationTarget; param: string }> = [
    ...getSynthControls(DEFAULT_SYNTH_PARAMS_A).map(c => ({ target: 'synthA' as const, param: c.id })),
    ...getSynthControls(DEFAULT_SYNTH_PARAMS_B).map(c => ({ target: 'synthB' as const, param: c.id })),
    ...getBass2Controls(DEFAULT_BASS2_PARAMS).map(c => ({ target: 'bass2' as const, param: c.id })),
    ...getKickControls(DEFAULT_KICK_PARAMS).map(c => ({ target: 'kick' as const, param: c.id })),
    ...getSnareControls(DEFAULT_SNARE_PARAMS).map(c => ({ target: 'snare' as const, param: c.id })),
    ...getClosedHatControls(DEFAULT_CLOSED_HAT_PARAMS).map(c => ({ target: 'closedHat' as const, param: c.id })),
    ...getOpenHatControls(DEFAULT_OPEN_HAT_PARAMS).map(c => ({ target: 'openHat' as const, param: c.id })),
    ...getSamplerControls(DEFAULT_SAMPLER_BANK_PARAMS).map(c => ({ target: 'sampler' as const, param: c.id })),
];
