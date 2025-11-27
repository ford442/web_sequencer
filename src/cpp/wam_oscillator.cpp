#include <math.h>
#include <stdlib.h>

#define PI 3.14159265359f

enum Waveform {
    SAW = 0,
    SQUARE = 1,
    TRIANGLE = 2,
    SINE = 3
};

class WamOscillator {
public:
    float phase = 0.0f;
    float sampleRate = 44100.0f;

    WamOscillator(float sr) : sampleRate(sr) {}

    float getNextSample(float frequency, int type) {
        float phaseIncrement = frequency / sampleRate;

        phase += phaseIncrement;
        if (phase > 1.0f) phase -= 1.0f;

        float value = 0.0f;
        switch (type) {
            case SAW:
                // Naive sawtooth
                value = 2.0f * phase - 1.0f;
                break;
            case SQUARE:
                // Naive square
                value = (phase < 0.5f) ? 1.0f : -1.0f;
                break;
            case TRIANGLE:
                // Naive triangle
                value = 2.0f * fabsf(2.0f * phase - 1.0f) - 1.0f;
                break;
            case SINE:
                value = sinf(2.0f * PI * phase);
                break;
        }
        return value;
    }

    void process(float* output, int length, float frequency, int type) {
        for (int i = 0; i < length; ++i) {
            output[i] = getNextSample(frequency, type);
        }
    }
};

extern "C" {
    // Factory function to create an oscillator instance
    WamOscillator* create_oscillator(float sampleRate) {
        return new WamOscillator(sampleRate);
    }

    // Process a block of audio
    void process_oscillator(WamOscillator* osc, float* output, int length, float frequency, int type) {
        if (osc) {
            osc->process(output, length, frequency, type);
        }
    }

    // Clean up
    void destroy_oscillator(WamOscillator* osc) {
        if (osc) delete osc;
    }
}
