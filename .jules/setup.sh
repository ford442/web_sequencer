# Emscripten version comes from emscripten/toolchain.json (the one pin).
EMSDK_VERSION="$(node -p "require('./emscripten/toolchain.json').emscripten.version")"
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION" && source ./emsdk_env.sh
npm install
