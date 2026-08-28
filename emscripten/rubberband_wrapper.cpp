#include <emscripten/bind.h>
#include <vector>
#include <iostream>

// Include the Rubber Band header from the cloned directory structure
#include "rubberband/RubberBandStretcher.h"

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

    void setFormantOption(int option) {
        RubberBand::RubberBandStretcher::Options opts = (RubberBand::RubberBandStretcher::Options)option;
        stretcher->setFormantOption(opts);
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
        // We assume the input from JS is a flat array.
        // If your JS sends interleaved data, you would de-interleave here.
        
        std::vector<const float*> channelPointers(stretcher->getChannelCount());
        int channelCount = stretcher->getChannelCount();
        
        for (int c = 0; c < channelCount; ++c) {
            // Offset the pointer for each channel (assuming Planar layout LLLL RRRR)
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
EMSCRIPTEN_BINDINGS(rubberband_module) {
    class_<RubberBandWrapper>("RubberBandStretcher")
        .constructor<int, int, int, double, double>()
        .function("reset", &RubberBandWrapper::reset)
        .function("setTimeRatio", &RubberBandWrapper::setTimeRatio)
        .function("setPitchScale", &RubberBandWrapper::setPitchScale)
        .function("setFormantOption", &RubberBandWrapper::setFormantOption)
        .function("getSamplesRequired", &RubberBandWrapper::getSamplesRequired)
        .function("getLatency", &RubberBandWrapper::getLatency)
        .function("available", &RubberBandWrapper::available)
        .function("process", &RubberBandWrapper::process)
        .function("retrieve", &RubberBandWrapper::retrieve);

    // Export Rubber Band option constants
    // Process options
    constant("OptionProcessRealTime", (int)RubberBand::RubberBandStretcher::OptionProcessRealTime);
    constant("OptionProcessOffline", (int)RubberBand::RubberBandStretcher::OptionProcessOffline);
    
    // Stretch options
    constant("OptionStretchElastic", (int)RubberBand::RubberBandStretcher::OptionStretchElastic);
    constant("OptionStretchPrecise", (int)RubberBand::RubberBandStretcher::OptionStretchPrecise);
    
    // Transient options
    constant("OptionTransientsCrisp", (int)RubberBand::RubberBandStretcher::OptionTransientsCrisp);
    constant("OptionTransientsMixed", (int)RubberBand::RubberBandStretcher::OptionTransientsMixed);
    constant("OptionTransientsSmooth", (int)RubberBand::RubberBandStretcher::OptionTransientsSmooth);
    
    // Phase options
    constant("OptionPhaseLaminar", (int)RubberBand::RubberBandStretcher::OptionPhaseLaminar);
    constant("OptionPhaseIndependent", (int)RubberBand::RubberBandStretcher::OptionPhaseIndependent);
    
    // Formant options
    constant("OptionFormantShifted", (int)RubberBand::RubberBandStretcher::OptionFormantShifted);
    constant("OptionFormantPreserved", (int)RubberBand::RubberBandStretcher::OptionFormantPreserved);
    
    // Engine options
    constant("OptionEngineFaster", (int)RubberBand::RubberBandStretcher::OptionEngineFaster);
    constant("OptionEngineFiner", (int)RubberBand::RubberBandStretcher::OptionEngineFiner);
    
    // Pitch options
    constant("OptionPitchHighSpeed", (int)RubberBand::RubberBandStretcher::OptionPitchHighSpeed);
    constant("OptionPitchHighQuality", (int)RubberBand::RubberBandStretcher::OptionPitchHighQuality);
    constant("OptionPitchHighConsistency", (int)RubberBand::RubberBandStretcher::OptionPitchHighConsistency);
    
    // Channel options
    constant("OptionChannelsApart", (int)RubberBand::RubberBandStretcher::OptionChannelsApart);
    constant("OptionChannelsTogether", (int)RubberBand::RubberBandStretcher::OptionChannelsTogether);
}
