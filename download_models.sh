#!/bin/bash
mkdir -p assets
cd assets

echo "Downloading models..."
# Download individual files if git lfs is tricky or just use curl
# Using curl for simplicity as suggested in plan, but git clone is better for updates.
# Let's stick to the user's typically preferred way or the plan. 
# Plan said "git clone https://huggingface.co/Supertone/supertonic assets"
# But we already have an assets dir potentially.

# Ensure we are in the root of the repo
cd ..

if [ -d "assets/.git" ]; then
    echo "Assets directory already exists and is a git repo. Pulling latest..."
    cd assets
    git pull
else
    echo "Cloning assets repository..."
    git clone https://huggingface.co/Supertone/supertonic assets
fi

echo "Done."
