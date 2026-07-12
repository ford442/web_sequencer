import re

with open('src/components/appParts/ContextMenuNode.tsx', 'r') as f:
    content = f.read()

# Fix ContextMenuNode TS error: it's passing `handleNotePropertyChange` from `useAppState.tsx`
# `handleNotePropertyChange` in `useAppState.tsx` is missing `slideFormant` in its first parameter signature.

with open('src/hooks/useAppState.tsx', 'r') as f:
    appstate = f.read()

appstate = appstate.replace(
    "'spectralPanRate' | 'spectralPanDepth' |",
    "'spectralPanRate' | 'spectralPanDepth' | 'slideFormant' | 'tremoloRate' | 'tremoloDepth' |"
)
appstate = appstate.replace(
    "'gateDepth' | 'gateRate' | 'tranceGate' | 'bitcrush' | 'downsample' | 'vocoderMix' | 'vocoderFormantShift' | 'vocoderPreservation' | 'vocoderAttack' | 'vocoderRelease' |",
    "'gateDepth' | 'gateRate' | 'tranceGate' | 'bitcrush' | 'downsample' | 'vocoderMix' | 'vocoderFormantShift' | 'vocoderPreservation' | 'vocoderAttack' | 'vocoderRelease' | 'pitchAmount' |"
)

with open('src/hooks/useAppState.tsx', 'w') as f:
    f.write(appstate)
