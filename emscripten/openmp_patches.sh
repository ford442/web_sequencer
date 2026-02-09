#!/bin/bash
# OpenMP Parallelization Patches for Rubberband Library
# This script adds OpenMP pragmas to rubberband source files

set -e

RUBBERBAND_SRC="$1"

if [ -z "$RUBBERBAND_SRC" ]; then
    echo "Usage: $0 <rubberband_source_dir>"
    exit 1
fi

echo "Applying OpenMP patches to Rubberband..."

# Function to add OpenMP include to a file
add_omp_include() {
    local file="$1"
    if [ -f "$file" ]; then
        # Check if already patched
        if ! grep -q "#include <omp.h>" "$file"; then
            echo "  Adding OpenMP include to $(basename $file)..."
            # Add after the first #include or at top
            sed -i '1s/^/#ifdef _OPENMP\n#include <omp.h>\n#endif\n/' "$file"
        fi
    fi
}

# Function to patch a specific loop pattern
patch_loop() {
    local file="$1"
    local pattern="$2"
    local pragma="$3"
    local description="$4"
    
    if [ -f "$file" ]; then
        echo "  Patching: $description in $(basename $file)..."
        # Use awk for multi-line replacements
        awk -v pattern="$pattern" -v pragma="$pragma" '
        $0 ~ pattern {
            print "#ifdef _OPENMP"
            print pragma
            print "#endif"
        }
        { print }
        ' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
    fi
}

# Add OpenMP includes
add_omp_include "$RUBBERBAND_SRC/src/faster/R2Stretcher.cpp"
add_omp_include "$RUBBERBAND_SRC/src/faster/StretcherProcess.cpp"
add_omp_include "$RUBBERBAND_SRC/src/finer/R3Stretcher.cpp"
add_omp_include "$RUBBERBAND_SRC/src/finer/R3LiveShifter.cpp"

# Patch R2Stretcher.cpp - channel loops
echo "Patching R2Stretcher.cpp..."
sed -i \
    -e 's/for (int c = 0; c < int(m_channels); ++c) {$/\#ifdef _OPENMP\n#pragma omp parallel for schedule(static) if(m_channels > 2)\n#endif\nfor (int c = 0; c < int(m_channels); ++c) {/' \
    "$RUBBERBAND_SRC/src/faster/R2Stretcher.cpp" 2>/dev/null || true

# Patch StretcherProcess.cpp
echo "Patching StretcherProcess.cpp..."
sed -i \
    -e 's/for (size_t i = 0; i < m_channels; ++i) {$/\#ifdef _OPENMP\n#pragma omp parallel for schedule(static) if(m_channels > 2)\n#endif\nfor (size_t i = 0; i < m_channels; ++i) {/' \
    "$RUBBERBAND_SRC/src/faster/StretcherProcess.cpp" 2>/dev/null || true

# Patch R3Stretcher.cpp - process/study loops
echo "Patching R3Stretcher.cpp..."
# Simple approach: add pragma before channel loops
awk '
/for \(int c = 0; c < m_parameters\.channels; \+\+c\) \{/ {
    # Check if this is in a process/study function context
    if (in_process_function) {
        print "#ifdef _OPENMP"
        print "#pragma omp parallel for schedule(dynamic, 1) if(m_parameters.channels > 2)"
        print "#endif"
    } else {
        print "#ifdef _OPENMP"
        print "#pragma omp parallel for schedule(static) if(m_parameters.channels > 2)"
        print "#endif"
    }
}
/process\s*\(/ { in_process_function = 1 }
/^\}/ { in_process_function = 0 }
{ print }
' "$RUBBERBAND_SRC/src/finer/R3Stretcher.cpp" > "${RUBBERBAND_SRC}/src/finer/R3Stretcher.cpp.tmp" && \
    mv "${RUBBERBAND_SRC}/src/finer/R3Stretcher.cpp.tmp" "$RUBBERBAND_SRC/src/finer/R3Stretcher.cpp"

# Patch R3LiveShifter.cpp
echo "Patching R3LiveShifter.cpp..."
sed -i \
    -e 's/for (int c = 0; c < m_parameters.channels; ++c) {$/\#ifdef _OPENMP\n#pragma omp parallel for schedule(static) if(m_parameters.channels > 2)\n#endif\nfor (int c = 0; c < m_parameters.channels; ++c) {/' \
    "$RUBBERBAND_SRC/src/finer/R3LiveShifter.cpp" 2>/dev/null || true

echo "OpenMP patches applied successfully!"
