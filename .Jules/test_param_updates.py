import re

with open('src/types/__tests__/samplerNoteParams.test.ts', 'r') as f:
    content = f.read()

content = content.replace("expectTypeOf<SamplerNoteParams>().toHaveProperty('vocoderMix');", "expectTypeOf<SamplerNoteParams>().toHaveProperty('vocoderMix');\n        expectTypeOf<SamplerNoteParams>().toHaveProperty('phonemeDelayAmount');\n        expectTypeOf<SamplerNoteParams>().toHaveProperty('phonemeDelayFeedback');")

with open('src/types/__tests__/samplerNoteParams.test.ts', 'w') as f:
    f.write(content)
