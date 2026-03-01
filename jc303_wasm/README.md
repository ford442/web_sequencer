# JC-303 Plugin

This is a Free Roland TB-303 clone plugin. A Cmake JUCE port of [Robin Schmidt`s Open303](https://github.com/RobinSchmidt/Open303) with added features.

![JC-303 Screenshot](https://raw.githubusercontent.com/midilab/jc303/main/img/jc303.png)

This software is licensed under the GNU General Public License version 3 (GPLv3).

The Open303 engine part of this software is also licensed under the MIT License.

## Web Audio (WebAssembly) Version

This repository also includes a **WebAssembly port** of the JC-303 synthesizer that runs directly in web browsers using the Web Audio API.

### Features (Web Version)

- Full Open303 TB-303 DSP engine compiled to WebAssembly
- Real-time audio synthesis in the browser
- Interactive virtual keyboard with computer keyboard support
- All main synthesizer parameters (Waveform, Cutoff, Resonance, EnvMod, Decay, Accent, Volume)
- Devil Fish MOD extended parameters
- No plugins or installations required - works in any modern browser

### Quick Start (Web Version)

1. Build the WebAssembly version (see Build Instructions below)
2. Serve the `wasm/dist` directory with any web server
3. Open in a browser and click "Click to Start" to initialize audio
4. Use mouse/touch on virtual keyboard or computer keys (A-L for white keys, W-P for black keys)

### Keyboard Controls

| Key | Note | Key | Note |
|-----|------|-----|------|
| A | C4 | K | C5 |
| W | C#4 | O | C#5 |
| S | D4 | L | D5 |
| E | D#4 | P | D#5 |
| D | E4 | ; | E5 |
| F | F4 | | |
| T | F#4 | | |
| G | G4 | | |
| Y | G#4 | | |
| H | A4 | | |
| U | A#4 | | |
| J | B4 | | |

Hold **Shift** while pressing a key for accented notes (higher velocity).

## Download

Supports Windows, Linux and MacOS. You may find CLAP, VST3, LV2 and AU formats available to download. For VST2 plugin you need to compile it by your own self using vst2 sdk from Steinberg - vstsdk2.4.

MacOS Universal - Intel and ARM: [jc303-macos_universal-plugins.zip](https://github.com/midilab/jc303/releases/download/v0.12.3/jc303-0.12.3-macos_universal-plugins.zip)

Windows Intel x64: [jc303-windows_x64-plugins.zip](https://github.com/midilab/jc303/releases/download/v0.12.3/jc303-0.12.3-windows_x64-plugins.zip)

Linux Intel x64: [jc303-linux_x64-plugins.zip](https://github.com/midilab/jc303/releases/download/v0.12.3/jc303-0.12.3-linux_x64-plugins.zip)  

Linux ARM64: Soon...  

## Installation

The platform zip pack will contain a folder per plugin format, just pick the format you want to install and copy the content of the folder to your OS plugin format folder.

**MacOs De-Quarantine**: MacOs users needs to de-quarantine plugin before load it into any DAW.  
Open a terminal window and do the following
```shell
$ sudo xattr -rd com.apple.quarantine /Library/Audio/Plug-Ins/Components/JC303.component
```
This de-quarantine example is for AU, please do the same for other formats you'll be using

## Build

Generate the cmake project build files first for the OS of your choice.  

#### cmake options

| Variable | Description | Default |
|--|--|--|
| GUI | Select GUI theme interface to use | amadeusp |
  
Avaliable themes: amadeusp, midilab  
  
To change JC303 GUI theme add the following to the first cmake call: -D GUI=midilab  
  
### Apple Xcode

To generate an **Xcode** project, run:

```sh
cmake -B build -G Xcode -D CMAKE_OSX_ARCHITECTURES=arm64\;x86_64 -D CMAKE_OSX_DEPLOYMENT_TARGET=10.13
```

The `-D CMAKE_OSX_ARCHITECTURES=arm64\;x86_64` flag is required to build universal binaries.

The `-D CMAKE_OSX_DEPLOYMENT_TARGET=10.13` flag sets the minimum MacOS version to be supported.

### Windows Visual Studio

To generate a **Visual Studio 2022 (17)** project, run:

```sh
cmake -B build -G "Visual Studio 17" -A x64
```

### GNU Linux

Install the dependecies:

#### Ubuntu

```sh
sudo apt install build-essential gcc cmake libx11-dev libxrandr-dev libxinerama-dev libxcursor-dev libfreetype6-dev libasound2-dev
```

To generate a **Linux CMake** project, run:

```sh
cmake -B build
```

## Compile

To compiled from the command line, run:

```sh
cmake --build build --config Release
```

#### VST2 Plugin

No distribution of VST2 plugin binaries is allowed without a license, but if you have the sdk and the license to use it just copy the vstsdk2.4/ SDK folder to the root of this project before run cmake.

## Build (WebAssembly)

The WebAssembly version allows the JC-303 to run in web browsers.

### Prerequisites

1. **Emscripten SDK** - The WebAssembly compiler toolchain

```sh
# Install Emscripten
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

2. **CMake** (version 3.15 or higher)

### Build Instructions

```sh
# Navigate to the wasm directory
cd wasm

# Run the build script
./build.sh

# Or build manually:
mkdir build && cd build
emcmake cmake ..
emmake make -j$(nproc)
```

### Output Files

After building, the `wasm/dist` directory will contain:

| File | Description |
|------|-------------|
| `jc303.js` | Emscripten JavaScript glue code |
| `jc303.wasm` | WebAssembly binary module |
| `jc303_worklet.js` | AudioWorklet-compatible module (single file) |
| `jc303-web.js` | High-level JavaScript API wrapper |
| `index.html` | Demo web page |

### Running Locally

```sh
cd wasm/dist
python3 -m http.server 8080
```

Then open http://localhost:8080 in your browser.

### Deploying to Production

Copy the contents of `wasm/dist` to your web server. The files can be served from any static file host.

**Note**: The server must send proper CORS headers and Content-Type for `.wasm` files (`application/wasm`).

### JavaScript API Usage

```javascript
// Create a new synthesizer instance
const synth = new JC303();

// Initialize (must be called after user interaction)
await synth.init();

// Play notes
synth.noteOn(60, 100);  // C4, velocity 100
synth.noteOff(60);

// Adjust parameters (0.0 - 1.0 range)
synth.setCutoff(0.5);
synth.setResonance(0.8);
synth.setEnvMod(0.6);
synth.setDecay(0.4);
synth.setWaveform(1.0);  // 0 = saw, 1 = square

// Enable Devil Fish MOD mode
synth.setModEnabled(true);
synth.setSlideTime(0.5);
synth.setSoftAttack(0.3);

// Cleanup when done
synth.destroy();
```

## Roadmap

1. ~~Binary release for MacOS, Windows and Linux~~
2. ~~Graphical User Interface~~
3. ~~Internal parameters for engine tunning -Inspired on Devilfish Mod~~
4. ~~Overdrive~~
5. Preset Support
6. Step Sequencer
7. ~~WebAssembly/Web Audio port~~
