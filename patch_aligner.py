import re

with open('src/engines/rubberband/PhonemeAligner.ts', 'r') as f:
    content = f.read()

# Add import for PhonemeData
import_statement = "import type { PhonemeData } from '../../types';\n"
if "import type { PhonemeData }" not in content:
    content = content.replace("export interface PhonemeSegment {", import_statement + "\nexport interface PhonemeSegment {")

# Update createSharedPhonemeBuffer
old_create = """    createSharedPhonemeBuffer(phonemes: PhonemeSegment[], sampleRate: number): SharedArrayBuffer {
        // 1 int for count + 4 floats per phoneme (start, end, isVowel, stretchRatio)
        const bufferSize = (1 + phonemes.length * 4) * 4; // 4 bytes per float32
        const sharedBuffer = new SharedArrayBuffer(bufferSize);
        const view = new Float32Array(sharedBuffer);

        view[0] = phonemes.length;

        for (let i = 0; i < phonemes.length; i++) {
            const p = phonemes[i];
            const baseIndex = 1 + i * 4;
            view[baseIndex] = p.start * sampleRate;     // Start sample
            view[baseIndex + 1] = p.end * sampleRate;   // End sample
            view[baseIndex + 2] = p.isVowel ? 1.0 : 0.0; // Boolean as float
            view[baseIndex + 3] = 1.0;                   // Default stretch ratio
        }

        return sharedBuffer;
    }"""

new_create = """    createSharedPhonemeBuffer(phonemes: PhonemeSegment[], sampleRate: number, userPhonemes?: PhonemeData[]): SharedArrayBuffer {
        // 1 int for count + 6 floats per phoneme (start, end, isVowel, stretchRatio, volume, pitchBend)
        const bufferSize = (1 + phonemes.length * 6) * 4; // 4 bytes per float32
        const sharedBuffer = new SharedArrayBuffer(bufferSize);
        const view = new Float32Array(sharedBuffer);

        view[0] = phonemes.length;

        for (let i = 0; i < phonemes.length; i++) {
            const p = phonemes[i];
            const baseIndex = 1 + i * 6;
            view[baseIndex] = p.start * sampleRate;     // Start sample
            view[baseIndex + 1] = p.end * sampleRate;   // End sample
            view[baseIndex + 2] = p.isVowel ? 1.0 : 0.0; // Boolean as float
            view[baseIndex + 3] = 1.0;                   // Default stretch ratio

            // Map user phoneme data if available
            let volume = 1.0;
            let pitchBend = 0.0;
            if (userPhonemes && userPhonemes.length > i) {
                // If userPhonemes are provided, we map them by index.
                // Alternatively, we could map them by normalized time,
                // but index matching aligns with how PhonemePainter initializes.
                const userP = userPhonemes[i];
                if (userP.volume !== undefined) volume = userP.volume;
                if (userP.pitchBend !== undefined) pitchBend = userP.pitchBend;
            }
            view[baseIndex + 4] = volume;
            view[baseIndex + 5] = pitchBend;
        }

        return sharedBuffer;
    }"""

content = content.replace(old_create, new_create)

with open('src/engines/rubberband/PhonemeAligner.ts', 'w') as f:
    f.write(content)

print("Patched PhonemeAligner.ts")
