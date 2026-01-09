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

    // Formant preservation option (for vocal processing)
    // 0 = Formants shifted with pitch (default)
    // 1 = Formants preserved (avoid chipmunk effect)
    void setFormantOption(int option) {
        RubberBand::RubberBandStretcher::Options opts;
        if (option == 1) {
            opts = RubberBand::RubberBandStretcher::OptionFormantPreserved;
        } else {
            opts = RubberBand::RubberBandStretcher::OptionFormantShifted;
        }
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
    
    int getChannelCount() {
        return stretcher->getChannelCount();
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
        .function("setFormantOption", &RubberBandWrapper::setFormantOption)
        .function("getSamplesRequired", &RubberBandWrapper::getSamplesRequired)
        .function("getLatency", &RubberBandWrapper::getLatency)
        .function("getChannelCount", &RubberBandWrapper::getChannelCount)
        .function("available", &RubberBandWrapper::available)
        .function("process", &RubberBandWrapper::process)
        .function("retrieve", &RubberBandWrapper::retrieve)
        // Expose Option Constants for JavaScript
        // Process options
        .class_property("OptionProcessOffline", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionProcessOffline)))
        .class_property("OptionProcessRealTime", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionProcessRealTime)))
        // Stretch options
        .class_property("OptionStretchElastic", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionStretchElastic)))
        .class_property("OptionStretchPrecise", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionStretchPrecise)))
        // Transient options
        .class_property("OptionTransientsCrisp", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionTransientsCrisp)))
        .class_property("OptionTransientsMixed", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionTransientsMixed)))
        .class_property("OptionTransientsSmooth", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionTransientsSmooth)))
        // Detector options
        .class_property("OptionDetectorCompound", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionDetectorCompound)))
        .class_property("OptionDetectorPercussive", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionDetectorPercussive)))
        .class_property("OptionDetectorSoft", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionDetectorSoft)))
        // Phase options
        .class_property("OptionPhaseLaminar", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionPhaseLaminar)))
        .class_property("OptionPhaseIndependent", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionPhaseIndependent)))
        // Threading options
        .class_property("OptionThreadingAuto", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionThreadingAuto)))
        .class_property("OptionThreadingNever", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionThreadingNever)))
        .class_property("OptionThreadingAlways", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionThreadingAlways)))
        // Window size options
        .class_property("OptionWindowStandard", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionWindowStandard)))
        .class_property("OptionWindowShort", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionWindowShort)))
        .class_property("OptionWindowLong", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionWindowLong)))
        // Smoothing options
        .class_property("OptionSmoothingOff", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionSmoothingOff)))
        .class_property("OptionSmoothingOn", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionSmoothingOn)))
        // Formant options (CRITICAL for vocal processing)
        .class_property("OptionFormantShifted", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionFormantShifted)))
        .class_property("OptionFormantPreserved", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionFormantPreserved)))
        // Pitch shift options
        .class_property("OptionPitchHighSpeed", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionPitchHighSpeed)))
        .class_property("OptionPitchHighQuality", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionPitchHighQuality)))
        .class_property("OptionPitchHighConsistency", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionPitchHighConsistency)))
        // Channels options
        .class_property("OptionChannelsApart", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionChannelsApart)))
        .class_property("OptionChannelsTogether", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionChannelsTogether)))
        // Engine options (R3 / Finer engine if available)
        .class_property("OptionEngineFaster", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionEngineFaster)))
        .class_property("OptionEngineFiner", val(static_cast<int>(RubberBand::RubberBandStretcher::OptionEngineFiner)));
}
