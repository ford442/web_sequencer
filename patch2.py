with open('src/components/SamplerPitchControls.tsx', 'r') as f:
    text = f.read()

text = text.replace("value={values.attack}", "value={values.attack ?? 0}")
text = text.replace("value={values.decay}", "value={values.decay ?? 0}")

with open('src/components/SamplerPitchControls.tsx', 'w') as f:
    f.write(text)
