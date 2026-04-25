import re

with open('src/types.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r'playDrum: \(sound: DrumSound, params: KickParams \| SnareParams \| HatParams, time: number, noteParams\?: \{ retrigger\?: number \}, stepTime\?: number\) => void;',
    r'playDrum: (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number, noteParams?: { retrigger?: number, reverbSend?: number, reverbType?: ReverbType }, stepTime?: number) => void;',
    content
)

with open('src/types.ts', 'w') as f:
    f.write(content)
