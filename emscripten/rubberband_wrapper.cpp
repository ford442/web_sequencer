// emscripten/rubberband_wrapper.cpp
#include <emscripten/bind.h>
#include <vector>

// Explicit relative path to the header
#include "rubberband/rubberband/RubberBandStretcher.h"

using namespace emscripten;

// Wrapper class to expose RubberBandStretcher to JavaScript
class RubberBandWrapper {
public:
    RubberBand::RubberBandStretcher* stretcher;

    RubberBandWrapper(int sampleRate, int channels, int options, double initialTimeRatio, double initialPitchScale) {
        RubberBand::RubberBandStretcher::Options opts = (RubberBand::RubberBandStretcher::Options)options;
        stretcher = new RubberBand::RubberBandStretcher(sampleRate, channels, opts, initialTimeRatio, initialPitchScale);
    }

    ~RubberBandWrapper() {
        delete stretcher;
    }

    void reset() {
        stretcher->reset();
    }

    void setTimeRatio(double ratio) {
        stretcher->setTimeRatio(ratio);
    }

    void setPitchScale(double scale) {
        stretcher->setPitchScale(scale);
    }

    int getSamplesRequired() {
        return stretcher->getSamplesRequired();
    }

    void study(uintptr_t inputPtr, int frames, bool final) {
        const float* input = reinterpret_cast<const float*>(inputPtr);
        
        // De-interleave if necessary, but RubberBand usually takes float** or interleaved depending on method.
        // Process takes float* const* (array of channel buffers).
        // For simplicity in JS <-> WASM, we often pass a single Float32Array and assume mono or handle de-interleaving here.
        // Let's assume input is a pointer to the start of the channel data (non-interleaved) or handle 1 channel for now.
        
        // To handle multiple channels properly from JS:
        // We accept a flat pointer. If stereo, we expect LLLL RRRR in memory? 
        // Or we create temporary pointers.
        
        std::vector<const float*> channelPointers(stretcher->getChannelCount());
        int channelCount = stretcher->getChannelCount();
        
        // Assuming input is non-interleaved (Planar) for simplicity in transfer
        for (int c = 0; c < channelCount; ++c) {
            channelPointers[c] = input + (c * frames);
        }

        stretcher->study(channelPointers.data(), frames, final);
    }

    void process(uintptr_t inputPtr, int frames, bool final) {
        const float* input = reinterpret_cast<const float*>(inputPtr);
        
        std::vector<const float*> channelPointers(stretcher->getChannelCount());
        int channelCount = stretcher->getChannelCount();
        
        for (int c = 0; c < channelCount; ++c) {
            channelPointers[c] = input + (c * frames);
        }

        stretcher->process(channelPointers.data(), frames, final);
    }

    int available() {
        return stretcher->available();
    }

    // Returns number of frames retrieved. 
    // Output must be pre-allocated in JS side to hold max possible output.
    int retrieve(uintptr_t outputPtr, int frames) {
        float* output = reinterpret_cast<float*>(outputPtr);
        
        std::vector<float*> channelPointers(stretcher->getChannelCount());
        int channelCount = stretcher->getChannelCount();
        
        for (int c = 0; c < channelCount; ++c) {
            channelPointers[c] = output + (c * frames);
        }

        return stretcher->retrieve(channelPointers.data(), frames);
    }
    
    // Quick helper to get expected latency
    int getLatency() {
        return stretcher->getLatency();
    }
};

// Bindings
EMSCRIPTEN_BINDINGS(rubberband_module) {
    class_<RubberBandWrapper>("RubberBandStretcher")
        .constructor<int, int, int, double, double>()
        .function("reset", &RubberBandWrapper::reset)
        .function("setTimeRatio", &RubberBandWrapper::setTimeRatio)
        .function("setPitchScale", &RubberBandWrapper::setPitchScale)
        .function("getSamplesRequired", &RubberBandWrapper::getSamplesRequired)
        .function("study", &RubberBandWrapper::study, allow_raw_pointers())
        .function("process", &RubberBandWrapper::process, allow_raw_pointers())
        .function("available", &RubberBandWrapper::available)
        .function("retrieve", &RubberBandWrapper::retrieve, allow_raw_pointers())
        .function("getLatency", &RubberBandWrapper::getLatency);
        
    // Export Options enum constants if needed, or just pass integers from JS
}
