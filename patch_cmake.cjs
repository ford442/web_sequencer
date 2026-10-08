const fs = require('fs');
const file = 'tools/jc303_cmake/CMakeLists.txt';
let content = fs.readFileSync(file, 'utf8');

// The new Emscripten compiler warns/errors on HEAPF32 in EXPORTED_RUNTIME_METHODS.
// We remove it from jc303_cmake/CMakeLists.txt and emscripten/build_rubberband.sh
const targetCMake = `"EXPORTED_RUNTIME_METHODS=[\\"ccall\\",\\"cwrap\\",\\"getValue\\",\\"setValue\\",\\"HEAPF32\\"]"`;
const replaceCMake = `"EXPORTED_RUNTIME_METHODS=[\\"ccall\\",\\"cwrap\\",\\"getValue\\",\\"setValue\\"]"`;

content = content.split(targetCMake).join(replaceCMake);
fs.writeFileSync(file, content);

const file2 = 'emscripten/build_rubberband.sh';
let content2 = fs.readFileSync(file2, 'utf8');
const targetRB = `-s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue", "setValue", "HEAPF32", "HEAPF64"]'`;
const replaceRB = `-s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue", "setValue"]'`;

content2 = content2.replace(targetRB, replaceRB);
fs.writeFileSync(file2, content2);
console.log("Patched correctly");
