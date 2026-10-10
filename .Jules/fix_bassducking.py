import re

with open('src/audio-worklets/rubberband-processor.ts', 'r') as f:
    content = f.read()

# Make bassDuckingScalar a member variable
content = content.replace("  private readonly bassDuck = new DrumDuckEnvelope();\n  private readonly phonemeDelay = new PhonemeDelayEffect();", "  private readonly bassDuck = new DrumDuckEnvelope();\n  private bassDuckingScalar = 0;\n  private readonly phonemeDelay = new PhonemeDelayEffect();")

# Remove the local variable declaration
content = content.replace("    const { duckingScalar: bassDuckingScalar } = this.bassDuck.process(\n      this.bassSidechainSAB, bassGrainSizeMod, currentTime, blockFrames, blockSampleRate\n    );", "    const bassDuckResult = this.bassDuck.process(\n      this.bassSidechainSAB, bassGrainSizeMod, currentTime, blockFrames, blockSampleRate\n    );\n    this.bassDuckingScalar = bassDuckResult.duckingScalar;")

# Use this.bassDuckingScalar in the freeze params
content = content.replace("          this.frozenGrainParams.bassDuckingScalar = bassDuckingScalar;", "          this.frozenGrainParams.bassDuckingScalar = this.bassDuckingScalar;")

with open('src/audio-worklets/rubberband-processor.ts', 'w') as f:
    f.write(content)
