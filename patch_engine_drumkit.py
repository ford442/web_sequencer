import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# I need to add drumKitEngineRef, prophecyManagerRef, synthABusRef to playbackRefs
# I also need to make sure drumKitEngineRef, synthABusRef, prophecyManagerRef are defined in useAudioEngine

insert_refs = """    const drumKitEngineRef = useRef<DrumKitEngine | null>(null);
    const synthABusRef = useRef<GainNode | null>(null);
    const prophecyManagerRef = useRef<ProphecyManager | null>(null);
"""
if 'const drumKitEngineRef' not in content:
    content = content.replace(
        'const singingVoiceManagerRef = useRef<SingingVoiceManager | null>(null);',
        f'const singingVoiceManagerRef = useRef<SingingVoiceManager | null>(null);\n{insert_refs}'
    )

content = content.replace(
    '        sidechainBusRef,\n    }), []);',
    '        sidechainBusRef,\n        drumKitEngineRef,\n        synthABusRef,\n        prophecyManagerRef,\n    }), []);'
)

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
