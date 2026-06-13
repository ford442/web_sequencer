import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()


search = """                const id = nextSamplerNoteId.current++;
                activeSamplerNotes.current.set(id, {
                    source,
                    envGain: gain,
                    expressiveNode,
                    releaseTime: params.release ?? 0.1,
                });
                return id;
            };"""


replace = """                const id = nextSamplerNoteId.current++;
                activeSamplerNotes.current.set(id, {
                    source,
                    envGain: gain,
                    releaseTime: params.release ?? 0.1,
                });
                return id;
            };"""


if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")

search2 = """            const noteOffSampler = (id: number) => {
                const note = activeSamplerNotes.current.get(id);
                if (note) {
                    const now = context.currentTime;
                    const releaseTime = note.releaseTime ?? 0.1;
                    note.expressiveNode?.parameters.get('gate')?.setValueAtTime(0, now);
                    note.envGain.gain.cancelScheduledValues(now);
                    note.envGain.gain.linearRampToValueAtTime(0, now + releaseTime);
                    // Keep source alive a tiny bit longer so gate-release tails can render cleanly.
                    note.source.stop(now + releaseTime + EXPRESSIVE_STOP_BUFFER_SECONDS);
                    note.source.addEventListener('ended', () => {
                        try { note.expressiveNode?.disconnect(); } catch { /* noop */ }
                    }, { once: true });
                    activeSamplerNotes.current.delete(id);
                }
            };"""

replace2 = """            const noteOffSampler = (id: number) => {
                const note = activeSamplerNotes.current.get(id);
                if (note) {
                    const now = context.currentTime;
                    const releaseTime = note.releaseTime ?? 0.1;
                    note.envGain.gain.cancelScheduledValues(now);
                    note.envGain.gain.linearRampToValueAtTime(0, now + releaseTime);
                    note.source.stop(now + releaseTime);
                    activeSamplerNotes.current.delete(id);
                }
            };"""


if search2 in content:
    content = content.replace(search2, replace2)
else:
    print("search2 not found")


with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
