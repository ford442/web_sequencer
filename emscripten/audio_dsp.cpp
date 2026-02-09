/**
 * Audio DSP Utilities with OpenMP Parallelization
 * 
 * Provides parallelized audio processing functions for:
 * - Buffer mixing and gain
 * - Channel interleave/deinterleave
 * - Peak detection
 * - Sample format conversion
 */

#include <emscripten/bind.h>
#include <vector>
#include <algorithm>
#include <cmath>

#ifdef _OPENMP
#include <omp.h>
#endif

using namespace emscripten;

/**
 * Apply gain to audio buffer in parallel
 * @param bufferPtr Pointer to float buffer
 * @param numFrames Number of frames (samples per channel)
 * @param numChannels Number of channels
 * @param gain Gain value to apply
 */
void applyGain(uintptr_t bufferPtr, int numFrames, int numChannels, float gain) {
    float* buffer = reinterpret_cast<float*>(bufferPtr);
    const int totalSamples = numFrames * numChannels;
    
    #ifdef _OPENMP
    #pragma omp parallel for simd schedule(static)
    #endif
    for (int i = 0; i < totalSamples; i++) {
        buffer[i] *= gain;
    }
}

/**
 * Mix multiple buffers into one with individual gains
 * @param outputPtr Output buffer pointer
 * @param inputPtrs Array of input buffer pointers
 * @param gains Array of gain values
 * @param numBuffers Number of input buffers
 * @param numFrames Number of frames per buffer
 * @param numChannels Number of channels
 */
void mixBuffers(
    uintptr_t outputPtr,
    uintptr_t inputPtrsPtr,
    uintptr_t gainsPtr,
    int numBuffers,
    int numFrames,
    int numChannels
) {
    float* output = reinterpret_cast<float*>(outputPtr);
    uintptr_t* inputPtrs = reinterpret_cast<uintptr_t*>(inputPtrsPtr);
    float* gains = reinterpret_cast<float*>(gainsPtr);
    
    const int totalSamples = numFrames * numChannels;
    
    // Clear output first
    #ifdef _OPENMP
    #pragma omp parallel for simd schedule(static)
    #endif
    for (int i = 0; i < totalSamples; i++) {
        output[i] = 0.0f;
    }
    
    // Mix each input buffer
    for (int b = 0; b < numBuffers; b++) {
        const float* input = reinterpret_cast<const float*>(inputPtrs[b]);
        const float gain = gains[b];
        
        #ifdef _OPENMP
        #pragma omp parallel for simd schedule(static)
        #endif
        for (int i = 0; i < totalSamples; i++) {
            output[i] += input[i] * gain;
        }
    }
}

/**
 * Find peak amplitude in buffer (parallel reduction)
 * @param bufferPtr Pointer to float buffer
 * @param numFrames Number of frames
 * @param numChannels Number of channels
 * @return Peak amplitude
 */
float findPeak(uintptr_t bufferPtr, int numFrames, int numChannels) {
    const float* buffer = reinterpret_cast<const float*>(bufferPtr);
    const int totalSamples = numFrames * numChannels;
    float peak = 0.0f;
    
    #ifdef _OPENMP
    #pragma omp parallel for reduction(max:peak) schedule(static)
    #endif
    for (int i = 0; i < totalSamples; i++) {
        const float absVal = std::abs(buffer[i]);
        if (absVal > peak) {
            peak = absVal;
        }
    }
    
    return peak;
}

/**
 * Deinterleave stereo buffer into separate channel arrays
 * @param interleavedPtr Interleaved input buffer (LRLRLR...)
 * @param leftPtr Left channel output
 * @param rightPtr Right channel output
 * @param numFrames Number of frames
 */
void deinterleaveStereo(
    uintptr_t interleavedPtr,
    uintptr_t leftPtr,
    uintptr_t rightPtr,
    int numFrames
) {
    const float* interleaved = reinterpret_cast<const float*>(interleavedPtr);
    float* left = reinterpret_cast<float*>(leftPtr);
    float* right = reinterpret_cast<float*>(rightPtr);
    
    #ifdef _OPENMP
    #pragma omp parallel for simd schedule(static)
    #endif
    for (int i = 0; i < numFrames; i++) {
        left[i] = interleaved[i * 2];
        right[i] = interleaved[i * 2 + 1];
    }
}

/**
 * Interleave separate channel arrays into stereo buffer
 * @param leftPtr Left channel input
 * @param rightPtr Right channel input
 * @param interleavedPtr Interleaved output buffer (LRLRLR...)
 * @param numFrames Number of frames
 */
void interleaveStereo(
    uintptr_t leftPtr,
    uintptr_t rightPtr,
    uintptr_t interleavedPtr,
    int numFrames
) {
    const float* left = reinterpret_cast<const float*>(leftPtr);
    const float* right = reinterpret_cast<const float*>(rightPtr);
    float* interleaved = reinterpret_cast<float*>(interleavedPtr);
    
    #ifdef _OPENMP
    #pragma omp parallel for simd schedule(static)
    #endif
    for (int i = 0; i < numFrames; i++) {
        interleaved[i * 2] = left[i];
        interleaved[i * 2 + 1] = right[i];
    }
}

/**
 * Convert float32 to int16 with clipping
 * @param floatPtr Input float buffer (-1.0 to 1.0)
 * @param int16Ptr Output int16 buffer
 * @param numSamples Number of samples
 */
void floatToInt16(uintptr_t floatPtr, uintptr_t int16Ptr, int numSamples) {
    const float* input = reinterpret_cast<const float*>(floatPtr);
    int16_t* output = reinterpret_cast<int16_t*>(int16Ptr);
    
    #ifdef _OPENMP
    #pragma omp parallel for simd schedule(static)
    #endif
    for (int i = 0; i < numSamples; i++) {
        float sample = input[i] * 32767.0f;
        // Hard clip
        if (sample > 32767.0f) sample = 32767.0f;
        if (sample < -32768.0f) sample = -32768.0f;
        output[i] = static_cast<int16_t>(sample);
    }
}

/**
 * Apply stereo width/panning
 * @param leftPtr Left channel buffer (in-place)
 * @param rightPtr Right channel buffer (in-place)
 * @param numFrames Number of frames
 * @param width Stereo width (0.0 = mono, 1.0 = full stereo, 2.0 = extra wide)
 */
void applyStereoWidth(
    uintptr_t leftPtr,
    uintptr_t rightPtr,
    int numFrames,
    float width
) {
    float* left = reinterpret_cast<float*>(leftPtr);
    float* right = reinterpret_cast<float*>(rightPtr);
    
    const float midScale = 1.0f - (width - 1.0f) * 0.5f;
    const float sideScale = width * 0.5f;
    
    #ifdef _OPENMP
    #pragma omp parallel for simd schedule(static)
    #endif
    for (int i = 0; i < numFrames; i++) {
        const float mid = (left[i] + right[i]) * 0.5f;
        const float side = (left[i] - right[i]) * 0.5f;
        
        left[i] = mid * midScale + side * sideScale;
        right[i] = mid * midScale - side * sideScale;
    }
}

/**
 * Get number of OpenMP threads available
 * @return Number of threads
 */
int getNumThreads() {
    #ifdef _OPENMP
    return omp_get_max_threads();
    #else
    return 1;
    #endif
}

/**
 * Set number of OpenMP threads
 * @param numThreads Number of threads to use
 */
void setNumThreads(int numThreads) {
    #ifdef _OPENMP
    omp_set_num_threads(numThreads);
    #endif
}

// Bindings
EMSCRIPTEN_BINDINGS(audio_dsp_module) {
    function("applyGain", &applyGain);
    function("mixBuffers", &mixBuffers);
    function("findPeak", &findPeak);
    function("deinterleaveStereo", &deinterleaveStereo);
    function("interleaveStereo", &interleaveStereo);
    function("floatToInt16", &floatToInt16);
    function("applyStereoWidth", &applyStereoWidth);
    function("getNumThreads", &getNumThreads);
    function("setNumThreads", &setNumThreads);
}
