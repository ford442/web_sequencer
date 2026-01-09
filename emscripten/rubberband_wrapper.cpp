#include <emscripten/bind.h>
#include <vector>
#include <iostream>

// Include the Rubber Band header from the cloned directory
#include "rubberband/rubberband/RubberBandStretcher.h"

using namespace emscripten;

class RubberBandWrapper {
public:
    RubberBand::RubberBandStretcher* stretcher;

    // Constructor matching Rubber Band's options
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

    int getLatency() {
        return stretcher->getLatency();
    }

    int available() {
        return stretcher->available();
    }

    // Process: Takes a pointer (heap offset) to the input float array
    void process(uintptr_t inputPtr, int frames, bool final) {
        const float* input = reinterpret_cast<const float*>(inputPtr);
        
        // Rubber Band expects an array of pointers (one per channel).
        // We assume the input from JS is a flat array (non-interleaved or mono).
        // If your JS sends interleaved data, you would de-interleave here.
        // For this implementation, we assume Planar (LLLL RRRR) or Mono.
        
        std::vector<const float*> channelPointers(stretcher->getChannelCount());
        int channelCount = stretcher->getChannelCount();
        
        for (int c = 0; c < channelCount; ++c) {
            // Offset the pointer for each channel
            channelPointers[c] = input + (c * frames);
        }

        stretcher->process(channelPointers.data(), frames, final);
    }

    // Retrieve: Writes output to the provided pointer
    int retrieve(uintptr_t outputPtr, int frames) {
        float* output = reinterpret_cast<float*>(outputPtr);
        
        std::vector<float*> channelPointers(stretcher->getChannelCount());
        int channelCount = stretcher->getChannelCount();
        
        for (int c = 0; c < channelCount; ++c) {
            channelPointers[c] = output + (c * frames);
        }

        return stretcher->retrieve(channelPointers.data(), frames);
    }
};

// Bindings
// We disable allow_raw_pointers() because we are passing uintptr_t (numbers), not C++ pointers.
EMSCRIPTEN_BINDINGS(rubberband_module) {
    class_<RubberBandWrapper>("RubberBandStretcher")
        .constructor<int, int, int, double, double>()
        .function("reset", &RubberBandWrapper::reset)
        .function("setTimeRatio", &RubberBandWrapper::setTimeRatio)
        .function("setPitchScale", &RubberBandWrapper::setPitchScale)
        .function("getSamplesRequired", &RubberBandWrapper::getSamplesRequired)
        .function("getLatency", &RubberBandWrapper::getLatency)
        .function("available", &RubberBandWrapper::available)
        .function("process", &RubberBandWrapper::process)
        .function("retrieve", &RubberBandWrapper::retrieve);
}
