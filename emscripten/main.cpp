#include <emscripten.h>
#include <stdio.h>

int main() {
    printf("[C++] WASM Main Initialized.\n");

    // @mode: emscripten_run_script
    // Trigger the JS function defined in our --post-js file
    // This makes C++ the "Orchestrator" of the engine boot sequence
    emscripten_run_script("if(globalThis.initPyodideSystem) globalThis.initPyodideSystem();");

    return 0;
}
