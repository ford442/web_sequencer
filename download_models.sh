#!/bin/bash
# Download and setup Supertonic TTS models for the web sequencer
set -e

echo "======================================"
echo "Supertonic TTS Model Setup"
echo "======================================"

# Clone or update the Supertonic repository
if [ -d "assets/.git" ]; then
    echo "✓ Assets directory exists. Pulling latest..."
    cd assets
    git pull
    cd ..
else
    echo "→ Cloning Supertonic repository..."
    git clone https://github.com/supertone-inc/supertonic.git assets
fi

# Create the public directory structure
echo "→ Creating public/assets/onnx directory structure..."
mkdir -p public/assets/onnx/voice_styles

# Copy ONNX models
echo "→ Copying ONNX models..."
if [ -d "assets/py/assets/onnx" ]; then
    cp assets/py/assets/onnx/*.onnx public/assets/onnx/ 2>/dev/null || echo "Warning: Some .onnx files may not exist"
    cp assets/py/assets/onnx/*.json public/assets/onnx/ 2>/dev/null || echo "Warning: Some .json files may not exist"
    echo "✓ Models copied"
else
    echo "Error: Could not find models in assets/py/assets/onnx"
    echo "Please ensure the Supertonic repo was cloned correctly"
    exit 1
fi

# Copy voice styles
echo "→ Copying voice styles..."
if [ -d "assets/py/assets/voice_styles" ]; then
    cp assets/py/assets/voice_styles/*.json public/assets/onnx/voice_styles/ 2>/dev/null || echo "Warning: Some voice style files may not exist"
    echo "✓ Voice styles copied"
else
    echo "Warning: Could not find voice_styles directory"
fi

# List what was copied
echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo "Files in public/assets/onnx:"
ls -lh public/assets/onnx/*.onnx 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
ls -lh public/assets/onnx/*.json 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""
echo "Voice styles:"
ls -lh public/assets/onnx/voice_styles/*.json 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""
echo "Next steps:"
echo "  1. Run 'npm run build' to build the project"
echo "  2. The TTS integration will load automatically when the app starts"
echo "  3. Check browser console for 'Supertonic: Ready' message"
echo ""
echo "For more information, see TTS_DEPLOYMENT.md"
