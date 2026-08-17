cmake_minimum_required(VERSION 3.15)
project(JC303_WASM VERSION 0.12.3)

# Hyphon-owned standalone JC-303 link contract.
# Memory/stack/pthread sizes come from emscripten/wasm_memory_budget.json
# via tools/build_jc303_omp.sh (-DJC303_*). Do not put byte literals here.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "This CMakeLists.txt is intended for Emscripten builds only. Use: emcmake cmake ...")
endif()

if(NOT DEFINED JC303_WASM_DIR)
    message(FATAL_ERROR "JC303_WASM_DIR must be set to the jc303_wasm/wasm directory")
endif()

foreach(_req JC303_INITIAL_MEMORY JC303_MAXIMUM_MEMORY JC303_STACK_SIZE)
    if(NOT DEFINED ${_req})
        message(FATAL_ERROR "${_req} must be passed from tools/build_jc303_omp.sh (wasm_memory_budget.json)")
    endif()
endforeach()

set(OPEN303_SOURCES
    ${JC303_WASM_DIR}/../src/dsp/open303/GlobalFunctions.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_AcidPattern.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_AcidSequencer.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_AnalogEnvelope.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_BiquadFilter.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_BlendOscillator.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_Complex.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_DecayEnvelope.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_EllipticQuarterBandFilter.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_FourierTransformerRadix2.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_FunctionTemplates.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_LeakyIntegrator.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_MidiNoteEvent.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_MipMappedWaveTable.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_NumberManipulations.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_OnePoleFilter.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_Open303.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_RealFunctions.cpp
    ${JC303_WASM_DIR}/../src/dsp/open303/rosic_TeeBeeFilter.cpp
)

set(WASM_SOURCES
    ${JC303_WASM_DIR}/jc303_wasm.cpp
)

include_directories(
    ${JC303_WASM_DIR}/../src/dsp/open303
)

add_executable(jc303 ${OPEN303_SOURCES} ${WASM_SOURCES})

option(ENABLE_WASM_DEBUG "Enable Emscripten debug flags (SAFE_HEAP/ASSERTIONS and -g)" OFF)

if(ENABLE_WASM_DEBUG)
    set(EMCC_LINK_FLAGS_LIST
        -s WASM=1
        -s MODULARIZE=1
        -s EXPORT_NAME=JC303Module
        -s "EXPORTED_FUNCTIONS=[\"_malloc\",\"_free\"]"
        -s "EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"HEAPF32\"]"
        -s ALLOW_MEMORY_GROWTH=1
        -s INITIAL_MEMORY=${JC303_INITIAL_MEMORY}
        -s MAXIMUM_MEMORY=${JC303_MAXIMUM_MEMORY}
        -s STACK_SIZE=${JC303_STACK_SIZE}
        -s NO_EXIT_RUNTIME=1
        -s ENVIRONMENT=web,worker
        -s SINGLE_FILE=0
        --bind
        --pre-js ${JC303_WASM_DIR}/early_wasm_table.js
        --post-js ${JC303_WASM_DIR}/compat_wasm_imports.js
        --post-js ${JC303_WASM_DIR}/safe_unbound_types.js
        -O0
        -g
        -sASSERTIONS=2
        -sSAFE_HEAP=1
    )
    string(REPLACE ";" " " EMCC_LINK_FLAGS "${EMCC_LINK_FLAGS_LIST}")

    set(EMCC_COMPILE_OPTIONS
        -O0
        -g
        -fno-exceptions
        -fno-rtti
        -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0
    )
else()
    set(EMCC_LINK_FLAGS_LIST
        -s WASM=1
        -s MODULARIZE=1
        -s EXPORT_NAME=JC303Module
        -s "EXPORTED_FUNCTIONS=[\"_malloc\",\"_free\"]"
        -s "EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"HEAPF32\"]"
        -s ALLOW_MEMORY_GROWTH=1
        -s INITIAL_MEMORY=${JC303_INITIAL_MEMORY}
        -s MAXIMUM_MEMORY=${JC303_MAXIMUM_MEMORY}
        -s STACK_SIZE=${JC303_STACK_SIZE}
        -s NO_EXIT_RUNTIME=1
        -s ENVIRONMENT=web,worker
        -s SINGLE_FILE=0
        -s STACK_OVERFLOW_CHECK=2
        --bind
        --pre-js ${JC303_WASM_DIR}/early_wasm_table.js
        --post-js ${JC303_WASM_DIR}/compat_wasm_imports.js
        --post-js ${JC303_WASM_DIR}/safe_unbound_types.js
        -O2
    )
    string(REPLACE ";" " " EMCC_LINK_FLAGS "${EMCC_LINK_FLAGS_LIST}")

    set(EMCC_COMPILE_OPTIONS
        -O2
        -fno-exceptions
        -fno-rtti
        -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0
    )
endif()

set_target_properties(jc303 PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "${EMCC_LINK_FLAGS}"
)

target_compile_options(jc303 PRIVATE ${EMCC_COMPILE_OPTIONS})

add_executable(jc303_worklet ${OPEN303_SOURCES} ${WASM_SOURCES})

if(ENABLE_WASM_DEBUG)
    set(EMCC_WORKLET_LINK_FLAGS_LIST
        -s WASM=1
        -s MODULARIZE=1
        -s EXPORT_NAME=JC303WorkletModule
        -s "EXPORTED_FUNCTIONS=[\"_malloc\",\"_free\"]"
        -s "EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"HEAPF32\"]"
        -s ALLOW_MEMORY_GROWTH=1
        -s INITIAL_MEMORY=${JC303_INITIAL_MEMORY}
        -s MAXIMUM_MEMORY=${JC303_MAXIMUM_MEMORY}
        -s STACK_SIZE=${JC303_STACK_SIZE}
        -s NO_EXIT_RUNTIME=1
        -s ENVIRONMENT=worker
        -s SINGLE_FILE=1
        -s STACK_OVERFLOW_CHECK=2
        --bind
        --pre-js ${JC303_WASM_DIR}/early_wasm_table.js
        --post-js ${JC303_WASM_DIR}/compat_wasm_imports.js
        -O0
        -g
        -sASSERTIONS=2
        -sSAFE_HEAP=1
    )
    string(REPLACE ";" " " EMCC_WORKLET_LINK_FLAGS "${EMCC_WORKLET_LINK_FLAGS_LIST}")

    set(EMCC_WORKLET_COMPILE_OPTIONS
        -O0
        -g
        -fno-exceptions
        -fno-rtti
        -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0
    )
else()
    set(EMCC_WORKLET_LINK_FLAGS_LIST
        -s WASM=1
        -s MODULARIZE=1
        -s EXPORT_NAME=JC303WorkletModule
        -s "EXPORTED_FUNCTIONS=[\"_malloc\",\"_free\"]"
        -s "EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"HEAPF32\"]"
        -s ALLOW_MEMORY_GROWTH=1
        -s INITIAL_MEMORY=${JC303_INITIAL_MEMORY}
        -s MAXIMUM_MEMORY=${JC303_MAXIMUM_MEMORY}
        -s STACK_SIZE=${JC303_STACK_SIZE}
        -s NO_EXIT_RUNTIME=1
        -s ENVIRONMENT=worker
        -s SINGLE_FILE=1
        -s STACK_OVERFLOW_CHECK=2
        --bind
        --pre-js ${JC303_WASM_DIR}/early_wasm_table.js
        --post-js ${JC303_WASM_DIR}/compat_wasm_imports.js
        --post-js ${JC303_WASM_DIR}/safe_unbound_types.js
        -O2
    )
    string(REPLACE ";" " " EMCC_WORKLET_LINK_FLAGS "${EMCC_WORKLET_LINK_FLAGS_LIST}")

    set(EMCC_WORKLET_COMPILE_OPTIONS
        -O2
        -fno-exceptions
        -fno-rtti
        -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0
    )
endif()

set_target_properties(jc303_worklet PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "${EMCC_WORKLET_LINK_FLAGS}"
)

target_compile_options(jc303_worklet PRIVATE ${EMCC_WORKLET_COMPILE_OPTIONS})

install(FILES
    ${CMAKE_BINARY_DIR}/jc303.js
    ${CMAKE_BINARY_DIR}/jc303.wasm
    ${CMAKE_BINARY_DIR}/jc303_worklet.js
    DESTINATION ${JC303_WASM_DIR}/dist
)
