# SuperTonic Voice Mixer

`voice-mixer.py` is a small PyQt5 tool to explore, mix, and modify existing Voice Style JSON files shipped with [SuperTonic TTS](https://github.com/supertone-inc/supertonic). It lets you visually edit the `style_ttl` latent space, apply DSP-style transforms, remix several voices, and listen to the result immediately via the built-in TTS preview. 

<img width="1104" height="980" alt="image" src="https://github.com/user-attachments/assets/928a2d10-2bc3-4704-8c3f-33b49c52508b" />

---

## What this project does

* Loads an existing SuperTonic voice style JSON (`style_ttl` / `style_dp`).
* Visualizes the timbre latent (`style_ttl`) as an interactive heatmap.
* Applies geometric and DSP operations to reshape the latent space.
* Mixes multiple existing voices into a single “remix” style.
* Generates speech with the current style and plays it directly.
* Saves the modified style back to a SuperTonic-compatible JSON file. 

---

## Installation

You need Python 3 and these packages (install via pip):

```bash
pip install numpy sounddevice matplotlib PyQt5 onnxruntime
```

### Option 1 – Use inside an existing SuperTonic installation

1. Install SuperTonic TTS from its official repository.
2. Copy `voice-mixer.py` into the same directory that contains SuperTonic’s `py/` folder. 
3. Ensure the following paths exist relative to `voice-mixer.py`:

   * `assets/onnx/` – ONNX models and config files from the official SuperTonic repo (duration_predictor, text_encoder, vector_estimator, vocoder, `tts.json`, `unicode_indexer.json`). 
   * `assets/voice_styles/` – folder with your existing voice style JSON files.

### Option 2 – Clone this repo and add assets

1. Clone this repository.
2. Copy `supertone/py/assets/` from the SuperTonic repo into this folder so you end up with `assets/onnx` and `assets/voice_styles`.
3. Alternatively, download `assets.zip` from the releases of this repo and unzip it next to `voice-mixer.py`:

   * `assets.zip` : [assets.zip](https://github.com/Topping1/Supertonic-Voice-Mixer/releases/download/alpha-v0.1/assets.zip)

### Expected folder structure

For the program to run, your directory must look like this:

```
your-folder/
│
├── voice-mixer.py
├── helper.py
│
└── assets/
    ├── config.json
    ├── LICENSE
    ├── README.md
    ├── onnx/
    │   ├── duration_predictor.onnx
    │   ├── text_encoder.onnx
    │   ├── vector_estimator.onnx
    │   ├── vocoder.onnx
    │   ├── tts.json
    │   ├── tts.yml
    │   └── unicode_indexer.json
    │
    └── voice_styles/
        ├── F1.json
        ├── F2.json
        ├── M1.json
        └── M2.json
```
---

## Running

From the folder containing `voice-mixer.py`:

```bash
python voice-mixer.py
```

The app will look for the ONNX models in `assets/onnx`. 

---

## GUI overview

### Header bar

* **Load Voice JSON**
  Opens a single voice style JSON (e.g. `assets/voice_styles/*.json`). Loads both `style_ttl` and `style_dp`. The `style_ttl` is shown in the heatmap; `style_dp` is kept as the reference duration/prosody style. 

* **Save Voice JSON**
  Saves the current edited `style_ttl` plus the current `style_dp` into a new SuperTonic-compatible JSON file. The output keeps the expected dimensions (`[1, 50, 256]` for `style_ttl`, `[1, 8, 16]` for `style_dp`) and adds simple metadata. 

* **Reset to Original**
  Restores the `style_ttl` heatmap to the originally loaded (or remixed) style.

* **Filename label**
  Shows the currently active voice file (or “Remix (N voices)” after a mix).

---

### Multi-Voice Mixer

* **Load Library (2+ files)**
  Select multiple JSON voice styles at once. Each style is stored internally for mixing.

* **Remix Library**
  Creates a new style by taking a random convex combination of all loaded voices (weights sum to 1). The result becomes the current “original” style displayed in the heatmap and can be further edited or saved as a new JSON. 

* **Status label**
  Shows how many voices are loaded and whether remixing is available.

---

### Timbre Heatmap (Style TTL)

This large panel shows `style_ttl` as a 2D matrix (time vs features).

* **Mouse interaction**

  * **Left-click**: shift columns (features) to the right (circular roll).
  * **Right-click**: shift rows (time/tokens) down (circular roll). 

The title displays the current shape, and axis labels remind you of the click actions.

---

### Latent Operations

All operations act on the currently visible `style_ttl` matrix.

#### Row 1 – Geometric / calculus

* **Mirror X**
  Flip left–right (feature axis).

* **Mirror Y**
  Flip top–bottom (time axis).

* **Invert Sign**
  Multiply all values by −1.

* **Derivative**
  Apply a gradient along the time axis to highlight changes.

* **Rand Shift**
  Randomly rolls the matrix along time and feature axes, simulating random click-drift in both directions.

#### Row 2 – DSP-style operations

These are creative, experimental transforms on the latent space:

* **Sharpen**
  Adds a derivative along features to accentuate “edges” in the latent pattern.

* **Quantize**
  Rounds values to a coarse grid (bit-crush-like effect).

* **Echo**
  Adds a delayed, attenuated copy along the feature axis (spectral smear).

* **Tremolo**
  Applies a sinusoidal amplitude modulation across features (spectral ripple).

* **Jitter**
  Multiplies each cell by a random factor in a small range.

#### Row 3 – Scalar math and stats

* **Val + Add**
  Adds a scalar offset to all cells (use small values, e.g. 0.01–0.1).

* **Factor + Multiply**
  Scales all cells by a scalar factor.

* **Min / Max label**
  Shows the current minimum and maximum of the matrix, useful to keep the style values within a reasonable range. 

---

### Inference Settings

* **Speed slider**
  Controls speech speed by scaling predicted durations. Values above 1.0 make speech faster/shorter; below 1.0 slower/longer.

* **Steps spinbox**
  Number of refinement steps for the latent diffusion process (1–50). Higher values generally improve quality but take longer.

---

### Text and Playback

* **Text box**
  Enter the text you want to synthesize. Multi-sentence input is supported; long text is internally chunked.

* **Generate & Play**
  Runs the TTS pipeline using the current `style_ttl` and `style_dp`, then plays the audio with `sounddevice`. CPU inference is used by default.  

---

## Saving and using new styles in SuperTonic

When you click **Save Voice JSON**, the tool writes a standard SuperTonic voice style JSON. You can:

1. Place the saved file into SuperTonic’s `assets/voice_styles/` folder (or wherever your installation expects style JSONs).
2. Configure SuperTonic to use that style as you would any of the built-in ones.

This lets you start from existing voices and iteratively sculpt new variants, all while staying compatible with the SuperTonic TTS pipeline.
