cmake_minimum_required(VERSION 3.15)
project(JC303_WASM VERSION 0.12.3)

# C++ Standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Emscripten check
if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "This CMakeLists.txt is intended for Emscripten builds only. Use: emcmake cmake ..")
endif()

# Source files from Open303 DSP engine
set(OPEN303_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/GlobalFunctions.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_AcidPattern.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_AcidSequencer.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_AnalogEnvelope.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_BiquadFilter.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_BlendOscillator.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_Complex.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_DecayEnvelope.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_EllipticQuarterBandFilter.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_FourierTransformerRadix2.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_FunctionTemplates.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_LeakyIntegrator.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_MidiNoteEvent.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_MipMappedWaveTable.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_NumberManipulations.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_OnePoleFilter.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_Open303.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_RealFunctions.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303/rosic_TeeBeeFilter.cpp
)

# WASM wrapper source
set(WASM_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/jc303_wasm.cpp
)

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/dsp/open303
)

# Create the WASM executable
add_executable(jc303 ${OPEN303_SOURCES} ${WASM_SOURCES})

# Option to enable extra Emscripten debug flags (SAFE_HEAP / ASSERTIONS / -g)
option(ENABLE_WASM_DEBUG "Enable Emscripten debug flags (SAFE_HEAP/ASSERTIONS and -g)" OFF)

# CRITICAL FIX: Massive stack size increase and memory configuration
# The 303 wavetable generation involves deep call chains and FFT operations
# that can consume significant stack space during initialization.
set(JC303_EMSCRIPTEN_STACK_SIZE 33554432)  # 32MB stack
set(JC303_EMSCRIPTEN_INITIAL_MEMORY 67108864)  # 64MB initial
set(JC303_EMSCRIPTEN_MAXIMUM_MEMORY 268435456)  # 256MB max

# Common link flags for all builds
set(JC303_COMMON_LINK_FLAGS
    -s WASM=1
    -s MODULARIZE=1
    -s EXPORT_NAME=JC303Module
    -s "EXPORTED_FUNCTIONS=[\"_malloc\",\"_free\"]"
    -s "EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"HEAPF32\"]"
    -s ALLOW_MEMORY_GROWTH=1
    -s INITIAL_MEMORY=${JC303_EMSCRIPTEN_INITIAL_MEMORY}
    -s MAXIMUM_MEMORY=${JC303_EMSCRIPTEN_MAXIMUM_MEMORY}
    -s STACK_SIZE=${JC303_EMSCRIPTEN_STACK_SIZE}
    -s TOTAL_STACK=${JC303_EMSCRIPTEN_STACK_SIZE}
    -s NO_EXIT_RUNTIME=1
    -s ENVIRONMENT=web,worker
    -s SINGLE_FILE=0
    -s STACK_OVERFLOW_CHECK=2
    -s DISABLE_EXCEPTION_CATCHING=1
    -fno-exceptions
    -fno-rtti
    --bind
    --pre-js ${CMAKE_CURRENT_SOURCE_DIR}/early_wasm_table.js
    --post-js ${CMAKE_CURRENT_SOURCE_DIR}/compat_wasm_imports.js
)

# Common compile flags
set(JC303_COMMON_COMPILE_FLAGS
    -fno-exceptions
    -fno-rtti
    -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0
    -DROSIC_WASM_SAFE_MODE=1
)

if(ENABLE_WASM_DEBUG)
    message(STATUS "JC303 WASM: Debug build enabled")
    set(JC303_LINK_FLAGS ${JC303_COMMON_LINK_FLAGS}
        --post-js ${CMAKE_CURRENT_SOURCE_DIR}/safe_unbound_types.js
        -O0
        -g
        -sASSERTIONS=2
        -sSAFE_HEAP=1
    )
    set(JC303_COMPILE_OPTIONS ${JC303_COMMON_COMPILE_FLAGS}
        -O0
        -g
    )
else()
    message(STATUS "JC303 WASM: Release build")
    set(JC303_LINK_FLAGS ${JC303_COMMON_LINK_FLAGS}
        --post-js ${CMAKE_CURRENT_SOURCE_DIR}/safe_unbound_types.js
        -O2
        -flto
    )
    set(JC303_COMPILE_OPTIONS ${JC303_COMMON_COMPILE_FLAGS}
        -O2
        -flto
    )
endif()

# Convert lists to space-separated strings for CMake
string(REPLACE ";" " " EMCC_LINK_FLAGS "${JC303_LINK_FLAGS}")
string(REPLACE ";" " " EMCC_COMPILE_OPTIONS "${JC303_COMPILE_OPTIONS}")

set_target_properties(jc303 PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "${EMCC_LINK_FLAGS}"
)

# Compiler flags
target_compile_options(jc303 PRIVATE ${JC303_COMPILE_OPTIONS})

# Create a separate AudioWorklet-compatible module
add_executable(jc303_worklet ${OPEN303_SOURCES} ${WASM_SOURCES})

# Worklet-specific flags (mostly same, but SINGLE_FILE=1 for worklet)
set(JC303_WORKLET_LINK_FLAGS ${JC303_COMMON_LINK_FLAGS})
list(REMOVE_ITEM JC303_WORKLET_LINK_FLAGS "-s" "SINGLE_FILE=0")
list(APPEND JC303_WORKLET_LINK_FLAGS "-s" "SINGLE_FILE=1")
list(APPEND JC303_WORKLET_LINK_FLAGS "-s" "EXPORT_NAME=JC303WorkletModule")

if(ENABLE_WASM_DEBUG)
    list(APPEND JC303_WORKLET_LINK_FLAGS "-O0" "-g" "-sASSERTIONS=2" "-sSAFE_HEAP=1")
    set(JC303_WORKLET_COMPILE_OPTIONS ${JC303_COMMON_COMPILE_FLAGS} "-O0" "-g")
else()
    list(APPEND JC303_WORKLET_LINK_FLAGS "-O2" "--post-js" "${CMAKE_CURRENT_SOURCE_DIR}/safe_unbound_types.js")
    set(JC303_WORKLET_COMPILE_OPTIONS ${JC303_COMMON_COMPILE_FLAGS} "-O2")
endif()

string(REPLACE ";" " " EMCC_WORKLET_LINK_FLAGS "${JC303_WORKLET_LINK_FLAGS}")
string(REPLACE ";" " " EMCC_WORKLET_COMPILE_OPTIONS "${JC303_WORKLET_COMPILE_OPTIONS}")

set_target_properties(jc303_worklet PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "${EMCC_WORKLET_LINK_FLAGS}"
)

target_compile_options(jc303_worklet PRIVATE ${JC303_WORKLET_COMPILE_OPTIONS})

# Installation rules
install(FILES
    ${CMAKE_BINARY_DIR}/jc303.js
    ${CMAKE_BINARY_DIR}/jc303.wasm
    ${CMAKE_BINARY_DIR}/jc303_worklet.js
    DESTINATION ${CMAKE_CURRENT_SOURCE_DIR}/dist
)
