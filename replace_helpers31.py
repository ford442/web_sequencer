import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

search = """                    if (expressiveNode) {
                        source.addEventListener('ended', () => {
                            try { expressiveNode?.disconnect(); } catch { /* noop */ }
                        });
                    }

                    source.start(startTime);
                    if (duration > 0) {
                        const releaseTime = params.release ?? 0.1;
                        if (expressiveNode) {
                            expressiveNode.parameters.get('gate')?.setValueAtTime(0, startTime + duration);
                            source.stop(startTime + duration + releaseTime + EXPRESSIVE_STOP_BUFFER_SECONDS);
                        } else {
                            source.stop(startTime + duration);
                        }
                    }"""


replace = """                    source.start(startTime);
                    if (duration > 0) {
                        source.stop(startTime + duration);
                    }"""

if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")

search2 = """                if (expressiveNode) {
                    source.connect(expressiveNode);
                    expressiveNode.connect(gain);
                } else {
                    source.connect(gain);
                }
                gain.connect(masterSaturationRef.current);
                source.start(now);

                const id = nextSamplerNoteId.current++;
                activeSamplerNotes.current.set(id, {
                    source,
                    envGain: gain,
                    expressiveNode,
                    releaseTime: params.release ?? 0.1,
                });"""

replace2 = """                source.connect(gain);
                gain.connect(masterSaturationRef.current);
                source.start(now);

                const id = nextSamplerNoteId.current++;
                activeSamplerNotes.current.set(id, {
                    source,
                    envGain: gain,
                    releaseTime: params.release ?? 0.1,
                });"""

if search2 in content:
    content = content.replace(search2, replace2)
else:
    print("search2 not found")

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
