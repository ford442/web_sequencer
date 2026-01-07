#include <emscripten/bind.h>
#include "RubberBandStretcher.h"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(rubberband) {
    class_<RubberBand::RubberBandStretcher>("RubberBandStretcher")
        .constructor<size_t, size_t, int, double, double>()
        .function("setTimeRatio", &RubberBand::RubberBandStretcher::setTimeRatio)
        ;
}
