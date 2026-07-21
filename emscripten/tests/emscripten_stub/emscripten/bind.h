/**
 * emscripten/bind.h — native test stub.
 *
 * Minimal no-op stand-in for embind so open303_wrapper.cpp's
 * EMSCRIPTEN_BINDINGS block compiles under a host g++. The bound functions are
 * exercised in the offline test via the plain extern "C" API, not embind, so
 * the registration body simply never runs.
 */
#pragma once

#include <string>

namespace emscripten {

// function("name", &fn) — accept and ignore any callable.
template <typename Fn>
inline void function(const char*, Fn) {}

}  // namespace emscripten

// EMSCRIPTEN_BINDINGS(name) { ... }  → a never-called static function.
#define EMSCRIPTEN_BINDINGS(name) [[maybe_unused]] static void emscripten_bindings_##name()
