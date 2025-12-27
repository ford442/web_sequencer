#!/bin/bash
set -e

echo "🚀 Starting Post-Build Optimization..."

# 1. Define Paths
PUBLIC_DIR="public"
PHYSICS_WASM="$PUBLIC_DIR/candy_physics.wasm"
NATIVE_WASM="$PUBLIC_DIR/candy_native.wasm"
NATIVE_JS="$PUBLIC_DIR/candy_native.js"
WORKER_JS="$PUBLIC_DIR/candy_native.worker.js"

# 2. Check for Tools
if ! command -v wasm-opt &> /dev/null; then
    echo "⚠️  wasm-opt not found! Install it via 'npm install -g binaryen' or 'apt install binaryen'"
    exit 1
fi

if ! command -v terser &> /dev/null; then
    echo "⚠️  terser not found! Install via 'npm install -g terser'"
    exit 1
fi

if ! command -v wasmedge &> /dev/null; then
    echo "⚠️  wasmedge not found! Installing via 'curl -sSf https://raw.githubusercontent.com/WasmEdge/WasmEdge/master/utils/install.sh | bash && source $HOME/.wasmedge/env'"
	curl -sSf https://raw.githubusercontent.com/WasmEdge/WasmEdge/master/utils/install.sh | bash && source $HOME/.wasmedge/env
fi

if ! command -v wasmedge &> /dev/null; then
    echo "⚠️  wasmedge still not found!"
fi

# 3. Optimize AssemblyScript WASM (Physics)
# We must explicitly enable the features we used in compilation.
echo "🔧 Optimizing Physics WASM..."
wasm-opt "$PHYSICS_WASM" -o "$PHYSICS_WASM" \
  -O3 \
  --converge \
  --strip-debug \
  --enable-simd \
  --enable-threads \
  --enable-bulk-memory \
  --enable-relaxed-simd \
  --enable-nontrapping-float-to-int

echo "🔧 Optimizing Physics WASM (wasmedge)..."
wasmedge compile --optimize=3 --enable-threads --enable-relaxed-simd "$PHYSICS_WASM" "$PHYSICS_WASM"

# 4. Optimize Emscripten WASM (Native Effects)
# Emscripten -O3 does a lot, but wasm-opt can usually squeeze another 5-10%
echo "🔧 Optimizing Native WASM..."
wasm-opt "$NATIVE_WASM" -o "$NATIVE_WASM" \
  -O3 \
  --converge \
  --strip-debug \
  --enable-simd \
  --enable-threads \
  --enable-relaxed-simd \
  --enable-bulk-memory \
  --enable-nontrapping-float-to-int
  
echo "🔧 Optimizing Native WASM (wasmedge)..."
wasmedge compile --optimize=3 --enable-threads --enable-relaxed-simd "$NATIVE_WASM" "$NATIVE_WASM"

# 5. Minify Emscripten Loaders (Safety First)
# We use -c (compress) and -m (mangle) but KEEP function names to avoid breaking
# Emscripten's dynamic linking if it relies on specific names.
#echo "📦 Minifying JS Loaders..."
#terser "$NATIVE_JS" -o "$NATIVE_JS" \
#  --compress defaults=false,dead_code=true,unused=true,loops=true,conditionals=true \
#  --mangle reserved=['Module','FS','GL'] \
#  --comments false

# Minify the worker file
#terser "$WORKER_JS" -o "$WORKER_JS" --compress --mangle --comments false

echo "✅ Optimization Complete!"
#ls -lh "$PUBLIC_DIR"/*.wasm "$PUBLIC_DIR"/*.js
