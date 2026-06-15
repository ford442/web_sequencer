import sys

with open('agent_plan.md', 'r') as f:
    content = f.read()

content = content.replace(
    """* **Idea:** "Vocal Pitch Envelope" - Add a dedicated pitch envelope (Attack/Decay/Amount) specifically for TTS phonemes to allow snappy pitch drops (like 808s) or slow, portamento-like rises on individual syllables, independent of standard melodic tracking.""",
    """* [x] **Idea:** "Vocal Pitch Envelope" - Add a dedicated pitch envelope (Attack/Decay/Amount) specifically for TTS phonemes to allow snappy pitch drops (like 808s) or slow, portamento-like rises on individual syllables, independent of standard melodic tracking."""
)

with open('agent_plan.md', 'w') as f:
    f.write(content)
