#!/bin/bash
# Sourced (not executed) by every em++ build script:
#   emscripten/build.sh, build_rubberband.sh, build_mix_bus.sh
#
# Puts the PINNED Emscripten on PATH and refuses to continue with any other one.
# The pin lives in exactly one place, emscripten/toolchain.json#emscripten.version;
# CI (.github/workflows/*.yml) reads the same field. A mismatched emcc used to build
# silently, which is how the committed flags drifted three majors away from the
# compiler that actually produced public/hyphon_native.*.
#
# Resolution order:
#   1. an emcc already on PATH whose version matches (CI's setup-emsdk, an activated shell)
#   2. $HYPHON_EMSDK/emsdk_env.sh, then the usual emsdk checkouts below — the first
#      one whose emcc matches wins
#
# HYPHON_ALLOW_UNPINNED_EMCC=1 builds with whatever emcc was found, loudly. Do not
# ship that output: the render-parity and export-map gates were validated on the pin.

_HYPHON_TOOLCHAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HYPHON_EMSCRIPTEN_PIN="$(node -p "require('$_HYPHON_TOOLCHAIN_DIR/toolchain.json').emscripten.version")"
export HYPHON_EMSCRIPTEN_PIN

_hyphon_emcc_version() {
    command -v emcc >/dev/null 2>&1 || return 1
    emcc -dumpversion 2>/dev/null | head -n1 | tr -d '[:space:]'
}

_HYPHON_FOUND=""
_HYPHON_SEEN=""
if [ "$(_hyphon_emcc_version || true)" = "$HYPHON_EMSCRIPTEN_PIN" ]; then
    _HYPHON_FOUND="PATH"
else
    _HYPHON_SEEN="$(_hyphon_emcc_version || true)"
    for _hyphon_env in \
        "${HYPHON_EMSDK:+$HYPHON_EMSDK/emsdk_env.sh}" \
        "/content/build_space/emsdk/emsdk_env.sh" \
        "$_HYPHON_TOOLCHAIN_DIR/../emsdk/emsdk_env.sh" \
        "$HOME/emsdk/emsdk_env.sh" \
        "/usr/local/emsdk/emsdk_env.sh" \
        "/opt/emsdk/emsdk_env.sh"; do
        [ -n "$_hyphon_env" ] && [ -f "$_hyphon_env" ] || continue
        # emsdk_env.sh is chatty on stderr; only the version check matters here.
        # shellcheck disable=SC1090
        source "$_hyphon_env" >/dev/null 2>&1 || continue
        _hyphon_v="$(_hyphon_emcc_version || true)"
        if [ "$_hyphon_v" = "$HYPHON_EMSCRIPTEN_PIN" ]; then
            _HYPHON_FOUND="$_hyphon_env"
            break
        fi
        _HYPHON_SEEN="${_HYPHON_SEEN:+$_HYPHON_SEEN, }$_hyphon_v ($_hyphon_env)"
    done
fi

if [ -z "$_HYPHON_FOUND" ]; then
    if [ "${HYPHON_ALLOW_UNPINNED_EMCC:-0}" = "1" ] && command -v emcc >/dev/null 2>&1; then
        echo "⚠️  Unpinned emcc $(_hyphon_emcc_version) allowed by HYPHON_ALLOW_UNPINNED_EMCC=1" >&2
        echo "⚠️  (pin: $HYPHON_EMSCRIPTEN_PIN). Do not ship this build." >&2
    else
        echo "❌ Emscripten $HYPHON_EMSCRIPTEN_PIN is required (emscripten/toolchain.json)." >&2
        echo "   found: ${_HYPHON_SEEN:-no emcc}" >&2
        echo "   Install it:  git clone https://github.com/emscripten-core/emsdk ~/emsdk && \\" >&2
        echo "                ~/emsdk/emsdk install $HYPHON_EMSCRIPTEN_PIN && ~/emsdk/emsdk activate $HYPHON_EMSCRIPTEN_PIN" >&2
        echo "   or point HYPHON_EMSDK at an emsdk checkout that has it activated." >&2
        exit 1
    fi
fi

echo "Using Emscripten $(_hyphon_emcc_version) (pin $HYPHON_EMSCRIPTEN_PIN, from ${_HYPHON_FOUND:-unpinned PATH})"
unset _hyphon_env _hyphon_v _HYPHON_SEEN
