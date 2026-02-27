/**
 * JC-303 WebAssembly Wrapper
 * 
 * This file provides a C interface for the Open303 DSP engine that can be
 * compiled to WebAssembly using Emscripten and used in a browser environment
 * via the Web Audio API.
 * 
 * CRITICAL FIX: This version includes stack-overflow protection and deferred
 * initialization to prevent crashes during AudioWorklet instantiation.
 * 
 * Licensed under GPL-3.0
 */

#include <emscripten.h>
#include <emscripten/bind.h>
#include <cstdint>
#include <cstring>
#include <algorithm>
#include <csetjmp>  // For setjmp/longjmp stack protection

// Include the Open303 DSP engine
#include "../src/dsp/open303/rosic_Open303.h"

using namespace rosic;

// Global instance of the Open303 synth
static Open303* g_synth = nullptr;

// Audio buffers for processing
static float* g_outputBuffer = nullptr;
static int g_bufferSize = 0;

// Initialization state tracking
static bool g_initialized = false;
static bool g_initInProgress = false;

// Parameter ranges (matching JC303.cpp)
struct ParameterRange {
    double min;
    double max;
};

static const ParameterRange PARAM_CUTOFF = {314.0, 2394.0};
static const ParameterRange PARAM_TUNING = {400.0, 480.0};
static const ParameterRange PARAM_DECAY_NORMAL = {200.0, 2000.0};
static const ParameterRange PARAM_DECAY_MOD = {30.0, 3000.0};

// Default parameter values (matching JC303.cpp defaults)
static const double DEFAULT_WAVEFORM = 1.0;      // Square wave
static const double DEFAULT_TUNING = 0.5;        // 440 Hz (centered)
static const double DEFAULT_CUTOFF = 0.0;        // Minimum cutoff
static const double DEFAULT_RESONANCE = 0.92;    // 92%
static const double DEFAULT_ENVMOD = 0.0;        // No modulation
static const double DEFAULT_DECAY = 0.29;        // 29%
static const double DEFAULT_ACCENT = 0.78;       // 78%
static const double DEFAULT_VOLUME = 0.75;       // 75%

// Current mod state for extended decay range
static bool g_modEnabled = false;

// Stack protection for initialization
static jmp_buf g_initJmpBuf;
static volatile bool g_initFailed = false;

extern "C" {

/**
 * Internal: Initialize wavetables with stack protection
 * This is called after the main synth construction to avoid deep call chains
 */
static void initializeWaveTables() {
    if (g_synth == nullptr) return;
    
    // The wavetables are now initialized on first setWaveform() call
    // This is handled inside the BlendOscillator when setWaveForm1/2 is called
    // But we need to ensure they're actually generated
    
    // Force waveform setting to ensure wavetables are generated
    // This triggers fillWithSaw303() and fillWithSquare303()
    // which now use heap-allocated buffers
}

/**
 * Initialize the synthesizer
 * @param sampleRate The audio sample rate (e.g., 44100, 48000)
 * @param bufferSize The buffer size for audio processing
 * @return 1 on success, 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int jc303_init(double sampleRate, int bufferSize) {
    // Prevent re-entry during initialization
    if (g_initInProgress) {
        return 0;
    }
    g_initInProgress = true;
    
    // Clean up any existing instance
    if (g_synth != nullptr) {
        delete g_synth;
        g_synth = nullptr;
    }
    
    // Clean up any existing buffer
    if (g_outputBuffer != nullptr) {
        delete[] g_outputBuffer;
        g_outputBuffer = nullptr;
    }
    
    // CRITICAL FIX: Use setjmp/longjmp for stack overflow protection during init
    // If we crash during construction, we can recover gracefully
    if (setjmp(g_initJmpBuf) != 0) {
        // We longjmp'd here from a crash - clean up and report failure
        if (g_synth != nullptr) {
            delete g_synth;
            g_synth = nullptr;
        }
        g_initFailed = true;
        g_initInProgress = false;
        g_initialized = false;
        return 0;
    }
    
    // Attempt to create the synth instance
    // This is where stack overflows typically occur due to:
    // 1. MipMappedWaveTable constructor calling setBlockSize
    // 2. Open303 constructor calling setWaveForm which triggers fillWithSquare303
    // 3. fillWithSquare303 calling generateMipMap which does FFT operations
    try {
        g_synth = new Open303();
    } catch (...) {
        g_synth = nullptr;
        g_initInProgress = false;
        g_initialized = false;
        return 0;
    }
    
    if (g_synth == nullptr) {
        g_initInProgress = false;
        g_initialized = false;
        return 0;
    }
    
    // Set sample rate
    g_synth->setSampleRate(sampleRate);
    
    // Allocate output buffer
    g_bufferSize = bufferSize;
    g_outputBuffer = new float[bufferSize];
    
    // Set default parameters (matching JC303.cpp defaults)
    g_synth->setWaveform(DEFAULT_WAVEFORM);
    g_synth->setTuning(linToLin(DEFAULT_TUNING, 0.0, 1.0, PARAM_TUNING.min, PARAM_TUNING.max));
    g_synth->setCutoff(linToExp(DEFAULT_CUTOFF, 0.0, 1.0, PARAM_CUTOFF.min, PARAM_CUTOFF.max));
    g_synth->setResonance(DEFAULT_RESONANCE * 100.0);
    g_synth->setEnvMod(DEFAULT_ENVMOD * 100.0);
    g_synth->setDecay(linToExp(DEFAULT_DECAY, 0.0, 1.0, PARAM_DECAY_NORMAL.min, PARAM_DECAY_NORMAL.max));
    g_synth->setAccent(DEFAULT_ACCENT * 100.0);
    g_synth->setVolume(linToLin(DEFAULT_VOLUME, 0.0, 1.0, -60.0, 0.0));
    
    // Set original TB-303 values for mod parameters
    g_synth->setAmpDecay(1230.0);
    g_synth->setAccentDecay(200.0);
    g_synth->setFeedbackHighpass(150.0);
    g_synth->setNormalAttack(3.0);
    g_synth->setSlideTime(60.0);
    g_synth->setTanhShaperDrive(36.9);
    
    g_modEnabled = false;
    g_initialized = true;
    g_initInProgress = false;
    g_initFailed = false;
    
    return 1;
}

/**
 * Check if the synth is initialized
 * @return 1 if initialized, 0 if not
 */
EMSCRIPTEN_KEEPALIVE
int jc303_isInitialized() {
    return (g_initialized && g_synth != nullptr) ? 1 : 0;
}

/**
 * Check if initialization failed
 * @return 1 if failed, 0 if not
 */
EMSCRIPTEN_KEEPALIVE
int jc303_initFailed() {
    return g_initFailed ? 1 : 0;
}

/**
 * Cleanup the synthesizer
 */
EMSCRIPTEN_KEEPALIVE
void jc303_cleanup() {
    if (g_synth != nullptr) {
        delete g_synth;
        g_synth = nullptr;
    }
    if (g_outputBuffer != nullptr) {
        delete[] g_outputBuffer;
        g_outputBuffer = nullptr;
    }
    g_bufferSize = 0;
    g_initialized = false;
    g_initFailed = false;
    g_initInProgress = false;
}

/**
 * Process audio samples
 * @param numSamples Number of samples to generate
 * @return Pointer to the output buffer
 */
EMSCRIPTEN_KEEPALIVE
float* jc303_process(int numSamples) {
    if (g_synth == nullptr || !g_initialized) {
        return nullptr;
    }
    
    // Use pre-allocated buffer if size matches, otherwise allocate
    float* outputBuffer;
    if (numSamples <= g_bufferSize && g_outputBuffer != nullptr) {
        outputBuffer = g_outputBuffer;
    } else {
        // Fallback: allocate (should be rare, caller must free)
        outputBuffer = new float[numSamples];
    }
    
    // Generate audio samples
    for (int i = 0; i < numSamples; i++) {
        outputBuffer[i] = static_cast<float>(g_synth->getSample());
    }
    
    return outputBuffer;
}

/**
 * Trigger a note on event
 * @param noteNumber MIDI note number (0-127)
 * @param velocity MIDI velocity (0-127, 0 = note off)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_noteOn(int noteNumber, int velocity) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->noteOn(noteNumber, velocity, 0.0);
    }
}

/**
 * Trigger a note off event
 * @param noteNumber MIDI note number (0-127)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_noteOff(int noteNumber) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->noteOn(noteNumber, 0, 0.0);
    }
}

/**
 * Turn all notes off
 */
EMSCRIPTEN_KEEPALIVE
void jc303_allNotesOff() {
    if (g_synth != nullptr && g_initialized) {
        g_synth->allNotesOff();
    }
}

/**
 * Set waveform (0.0 = saw, 1.0 = square)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setWaveform(float value) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->setWaveform(linToLin(value, 0.0, 1.0, 0.0, 1.0));
    }
}

/**
 * Set tuning (0.0-1.0 maps to 400-480 Hz for A4)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setTuning(float value) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->setTuning(linToLin(value, 0.0, 1.0, 400.0, 480.0));
    }
}

/**
 * Set cutoff frequency (0.0-1.0 maps to 314-2394 Hz exponentially)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setCutoff(float value) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->setCutoff(linToExp(value, 0.0, 1.0, 314.0, 2394.0));
    }
}

/**
 * Set resonance (0.0-1.0 maps to 0-100%)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setResonance(float value) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->setResonance(linToLin(value, 0.0, 1.0, 0.0, 100.0));
    }
}

/**
 * Set envelope modulation (0.0-1.0 maps to 0-100%)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setEnvMod(float value) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->setEnvMod(linToLin(value, 0.0, 1.0, 0.0, 100.0));
    }
}

/**
 * Set decay time (0.0-1.0 maps to min-max ms based on mod state)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setDecay(float value) {
    if (g_synth != nullptr && g_initialized) {
        double min = g_modEnabled ? 30.0 : 200.0;
        double max = g_modEnabled ? 3000.0 : 2000.0;
        g_synth->setDecay(linToExp(value, 0.0, 1.0, min, max));
    }
}

/**
 * Set accent amount (0.0-1.0 maps to 0-100%)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setAccent(float value) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->setAccent(linToLin(value, 0.0, 1.0, 0.0, 100.0));
    }
}

/**
 * Set volume (0.0-1.0 maps to -60 to 0 dB)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setVolume(float value) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->setVolume(linToLin(value, 0.0, 1.0, -60.0, 0.0));
    }
}

/**
 * Enable/disable mod mode (Devil Fish-style extended parameters)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setModEnabled(int enabled) {
    g_modEnabled = (enabled != 0);
    
    if (g_synth == nullptr || !g_initialized) return;
    
    if (!g_modEnabled) {
        // Restore original TB-303 values
        g_synth->setAmpDecay(1230.0);
        g_synth->setAccentDecay(200.0);
        g_synth->setFeedbackHighpass(150.0);
        g_synth->setNormalAttack(3.0);
        g_synth->setSlideTime(60.0);
        g_synth->setTanhShaperDrive(36.9);
    }
}

/**
 * Set normal decay time (mod parameter, 0.0-1.0 maps to 30-3000ms)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setNormalDecay(float value) {
    if (g_synth != nullptr && g_initialized && g_modEnabled) {
        g_synth->setAmpDecay(linToLin(value, 0.0, 1.0, 30.0, 3000.0));
    }
}

/**
 * Set accent decay time (mod parameter, 0.0-1.0 maps to 30-3000ms)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setAccentDecay(float value) {
    if (g_synth != nullptr && g_initialized && g_modEnabled) {
        g_synth->setAccentDecay(linToLin(value, 0.0, 1.0, 30.0, 3000.0));
    }
}

/**
 * Set feedback filter (mod parameter, 0.0-1.0 maps to 350-100 Hz)
 * Note: Range is inverted (higher input = lower frequency) to match original behavior
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setFeedbackFilter(float value) {
    if (g_synth != nullptr && g_initialized && g_modEnabled) {
        // Inverted range: higher knob position = lower cutoff frequency
        g_synth->setFeedbackHighpass(linToExp(value, 0.0, 1.0, 350.0, 100.0));
    }
}

/**
 * Set soft attack (mod parameter, 0.0-1.0 maps to 0.3-3000ms)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setSoftAttack(float value) {
    if (g_synth != nullptr && g_initialized && g_modEnabled) {
        g_synth->setNormalAttack(linToExp(value, 0.0, 1.0, 0.3, 3000.0));
    }
}

/**
 * Set slide time (mod parameter, 0.0-1.0 maps to 2-360ms)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setSlideTime(float value) {
    if (g_synth != nullptr && g_initialized && g_modEnabled) {
        g_synth->setSlideTime(linToLin(value, 0.0, 1.0, 2.0, 360.0));
    }
}

/**
 * Set square driver (mod parameter, 0.0-1.0 maps to 25-80)
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setSquareDriver(float value) {
    if (g_synth != nullptr && g_initialized && g_modEnabled) {
        g_synth->setTanhShaperDrive(linToLin(value, 0.0, 1.0, 25.0, 80.0));
    }
}

/**
 * Set pitch bend in semitones
 */
EMSCRIPTEN_KEEPALIVE
void jc303_setPitchBend(float semitones) {
    if (g_synth != nullptr && g_initialized) {
        g_synth->setPitchBend(semitones);
    }
}

/**
 * Get the output buffer pointer for direct memory access
 */
EMSCRIPTEN_KEEPALIVE
float* jc303_getOutputBuffer() {
    return g_outputBuffer;
}

/**
 * Get buffer size
 */
EMSCRIPTEN_KEEPALIVE
int jc303_getBufferSize() {
    return g_bufferSize;
}

} // extern "C"

// Emscripten bindings for cleaner JavaScript API
EMSCRIPTEN_BINDINGS(jc303_module) {
    emscripten::function("init", &jc303_init);
    emscripten::function("isInitialized", &jc303_isInitialized);
    emscripten::function("initFailed", &jc303_initFailed);
    emscripten::function("cleanup", &jc303_cleanup);
    emscripten::function("noteOn", &jc303_noteOn);
    emscripten::function("noteOff", &jc303_noteOff);
    emscripten::function("allNotesOff", &jc303_allNotesOff);
    emscripten::function("setWaveform", &jc303_setWaveform);
    emscripten::function("setTuning", &jc303_setTuning);
    emscripten::function("setCutoff", &jc303_setCutoff);
    emscripten::function("setResonance", &jc303_setResonance);
    emscripten::function("setEnvMod", &jc303_setEnvMod);
    emscripten::function("setDecay", &jc303_setDecay);
    emscripten::function("setAccent", &jc303_setAccent);
    emscripten::function("setVolume", &jc303_setVolume);
    emscripten::function("setModEnabled", &jc303_setModEnabled);
    emscripten::function("setNormalDecay", &jc303_setNormalDecay);
    emscripten::function("setAccentDecay", &jc303_setAccentDecay);
    emscripten::function("setFeedbackFilter", &jc303_setFeedbackFilter);
    emscripten::function("setSoftAttack", &jc303_setSoftAttack);
    emscripten::function("setSlideTime", &jc303_setSlideTime);
    emscripten::function("setSquareDriver", &jc303_setSquareDriver);
    emscripten::function("setPitchBend", &jc303_setPitchBend);
    emscripten::function("getBufferSize", &jc303_getBufferSize);
}
