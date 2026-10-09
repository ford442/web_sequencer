/**
 * emscripten.h — native test stub.
 *
 * Lets emscripten/open303_wrapper.cpp compile and run under a host g++ so the
 * open303-family "303 voice" coefficient profiles can be verified with an
 * offline buffer render, without the emsdk toolchain. NOT used in the real
 * WASM build (that uses the genuine emscripten headers).
 */
#pragma once

#ifndef EMSCRIPTEN_KEEPALIVE
#define EMSCRIPTEN_KEEPALIVE
#endif
