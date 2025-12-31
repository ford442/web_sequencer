
// file: emscripten/pyodide_bootstrap.js

// 1. Global storage for the Pyodide instance so React can access it later
globalThis.hyphonPyodide = null;
globalThis.hyphonPyodideReady = false;

// 2. The Python code (moved from your hook for cleaner bundling)
const INTERNAL_PYTHON_CODE = `
import numpy as np
from scipy import signal
import json

SAMPLE_RATE = 44100

def set_sample_rate(rate):
    global SAMPLE_RATE
    SAMPLE_RATE = int(rate)
    print(f"Python sample rate set to: {SAMPLE_RATE}")

# --- 1. ANALYSIS: PITCH & SPECTRAL ---

def detect_pitch_yin(sig, sr, min_freq=50, max_freq=2000):
    """
    Simplified YIN-like autocorrelation for fundamental frequency detection.
    """
    if len(sig) < 2048: return 0.0

    # Auto-correlation
    corr = signal.correlate(sig, sig, mode='full')
    corr = corr[len(corr)//2:]

    # Difference function (cumulative mean normalized difference)
    # Simplified: just use peak picking on autocorrelation for speed in WASM
    # Skip the first peak (lag 0)
    diff = np.diff(corr)
    starts = np.where(diff > 0)[0]
    if len(starts) == 0: return 0.0

    # Find max peak in valid range
    min_period = int(sr / max_freq)
    max_period = int(sr / min_freq)

    region = corr[min_period:max_period]
    if len(region) == 0: return 0.0

    peak_idx = np.argmax(region) + min_period

    # Parabolic interpolation for precision
    if 0 < peak_idx < len(corr) - 1:
        alpha = corr[peak_idx-1]
        beta = corr[peak_idx]
        gamma = corr[peak_idx+1]
        offset = 0.5 * (alpha - gamma) / (alpha - 2*beta + gamma)
        true_peak = peak_idx + offset
    else:
        true_peak = peak_idx

    return float(sr / true_peak)

# --- 2. FREQUENCY DOMAIN: PHASE VOCODER (For Singing) ---

def phase_vocoder(y, rate):
    """
    Time-stretches signal 'y' by factor 'rate' using STFT Phase Vocoder.
    rate > 1.0 = Slower (Stretch)
    rate < 1.0 = Faster (Compress)
    """
    n_fft = 2048
    hop_length = n_fft // 4

    # 1. Analyze (STFT)
    # Zxx is complex spec: Magnitude + Phase
    spec = signal.stft(y, nperseg=n_fft, noverlap=n_fft-hop_length)[2]

    # 2. Modify (Phase Propagation)
    rows, cols = spec.shape
    new_cols = int(cols * rate)

    # Create new time points
    time_old = np.linspace(0, cols, cols)
    time_new = np.linspace(0, cols, new_cols)

    # Interpolate Magnitude (Linear)
    # We interpret the magnitude to smear it across new time
    new_spec = np.zeros((rows, new_cols), dtype=np.complex128)

    # Calculate Phase Advance
    # The phase difference between frames
    phi_advance = np.linspace(0, np.pi * hop_length, rows)

    phase_acc = np.angle(spec[:, 0])

    # Iterate through new time steps
    # This is a basic loop; optimized "vectorized" PV is hard in pure numpy without heavy memory usage
    for t in range(new_cols):
        # Find corresponding time in old spec
        old_t = time_new[t]
        idx = int(np.floor(old_t))
        alpha = old_t - idx

        if idx >= cols - 1:
            col_0 = spec[:, -1]
            col_1 = spec[:, -1]
        else:
            col_0 = spec[:, idx]
            col_1 = spec[:, idx+1]

        # Mag Interpolation
        mag = (1 - alpha) * np.abs(col_0) + alpha * np.abs(col_1)

        # Phase Vocoding Logic
        # Calculate phase difference
        phase_0 = np.angle(col_0)
        phase_1 = np.angle(col_1)

        dphase = phase_1 - phase_0 - phi_advance
        dphase -= 2 * np.pi * np.round(dphase / (2 * np.pi))
        dphase += phi_advance

        phase_acc += dphase

        new_spec[:, t] = mag * np.exp(1j * phase_acc)

    # 3. Synthesize (ISTFT)
    _, y_stretch = signal.istft(new_spec, nperseg=n_fft, noverlap=n_fft-hop_length)

    return y_stretch

def shift_pitch_pv(y, n_semitones):
    """
    Shifts pitch WITHOUT changing duration using Phase Vocoder.
    Method:
    1. Resample (changes pitch AND duration)
    2. Time-stretch (fix duration, keep pitch)
    """
    factor = 2 ** (n_semitones / 12.0)

    # 1. Resample (The "Mickey Mouse" step, sorry - preserving formants requires Cepstral analysis)
    # New length
    new_len = int(len(y) / factor)
    y_resampled = signal.resample(y, new_len)

    # 2. Stretch back to original length
    # If we pitched UP (factor > 1), duration is too short. We need to STRETCH (rate > 1).
    stretch_factor = len(y) / len(y_resampled)

    y_shifted = phase_vocoder(y_resampled, stretch_factor)

    # Trim/Pad to match exactly
    if len(y_shifted) > len(y):
        y_shifted = y_shifted[:len(y)]
    else:
        y_shifted = np.pad(y_shifted, (0, len(y) - len(y_shifted)))

    return y_shifted

# --- 3. TIME DOMAIN: GRANULAR (For Spoons/Percussion) ---

def granular_pitch_shift(y, n_semitones, grain_size_ms=30, overlap=0.5):
    """
    Shifts pitch using Granular Resynthesis.
    Good for transients/spoons because it preserves the "hit" envelope better than FFT.
    """
    rate = 2 ** (n_semitones / 12.0)

    grain_samples = int(SAMPLE_RATE * (grain_size_ms / 1000.0))
    hop_size = int(grain_samples * (1 - overlap))

    output = np.zeros(len(y))
    input_idx = 0
    output_idx = 0

    # Simple PSOLA-ish approach:
    # We want to resample the GRAIN (to shift pitch), but place it at the original TIME.

    while output_idx < len(y) - grain_samples:
        # Extract Grain
        grain = y[int(input_idx) : int(input_idx) + grain_samples]
        if len(grain) < grain_samples: break

        # Window
        win = np.hanning(len(grain))
        grain = grain * win

        # Resample Grain (Pitch Shift)
        # Pitch UP = Shorter grain
        grain_shifted = signal.resample(grain, int(len(grain) / rate))

        # Overlap-Add to Output
        # We place it at output_idx (preserving rhythm)
        L = len(grain_shifted)
        if output_idx + L < len(output):
            output[output_idx : output_idx + L] += grain_shifted

        output_idx += hop_size
        input_idx += hop_size

    return output

# --- 4. EXPOSED WORKFLOWS ---

SAMPLES = {}

def load_sample(name, data):
    """
    Loads a float32 array into the global samples dict.
    Data is expected to be already at SAMPLE_RATE.
    """
    try:
        # Convert JS Proxy/List to Numpy array
        SAMPLES[name] = np.array(data, dtype=np.float64)
        print(f"Sample '{name}' loaded. Length: {len(SAMPLES[name])}")
    except Exception as e:
        print(f"Error loading sample {name}: {e}")

def analyze_sample(data):
    """ Return Pitch Data """
    try:
        y = np.array(data, dtype=np.float64)
        pitch = detect_pitch_yin(y, SAMPLE_RATE)
        return json.dumps({"freq": pitch})
    except Exception as e:
        print(f"Error analyzing sample: {e}")
        return json.dumps({"freq": 0})

def process_singing_sample(name, target_note, steps, bpm):
    """
    THE SINGER: Uses Phase Vocoder
    1. Detects original pitch
    2. Shifts to target pitch (resample)
    3. Stretches to target duration (PV)
    """
    if name not in SAMPLES: return np.zeros(128)
    y = SAMPLES[name]

    # 1. Target Duration
    step_sec = 60.0 / bpm / 4.0
    target_dur_sec = steps * step_sec

    # 2. Pitch Shift
    # Detect original
    f0 = detect_pitch_yin(y, SAMPLE_RATE)
    if f0 == 0: f0 = 440.0

    # Target Freq
    # (Simple mapping for demo)
    NOTES = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
    try:
        n = target_note.upper()
        octave = int(n[-1])
        note = n[:-1]
        semi = NOTES.get(note, 0)
        target_midi = (octave + 1) * 12 + semi
        orig_midi = 69 + 12 * np.log2(f0 / 440.0)
        diff = target_midi - orig_midi
    except:
        diff = 0

    # Apply Pitch Shift (PV method to keep duration)
    y_tuned = shift_pitch_pv(y, diff)

    # 3. Time Stretch (to match sequencer step length exactly)
    # current duration
    curr_dur = len(y_tuned) / SAMPLE_RATE
    stretch_ratio = target_dur_sec / curr_dur

    # If ratio is huge, it will sound artifacty.
    # Use Phase Vocoder again to stretch to exact step length
    y_final = phase_vocoder(y_tuned, stretch_ratio)

    return y_final.astype(np.float64)

def process_spoon_sample(name, target_note):
    """
    THE SPOON: Uses Granular Synthesis
    1. Detects pitch
    2. Shifts pitch using Granular (preserves attack transient)
    """
    if name not in SAMPLES: return np.zeros(128)
    y = SAMPLES[name]

    f0 = detect_pitch_yin(y, SAMPLE_RATE)
    if f0 == 0: f0 = 440.0 # Default if just a click

    # Target calc (same as above, abstracted in real code)
    NOTES = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
    try:
        n = target_note.upper()
        octave = int(n[-1])
        note = n[:-1]
        semi = NOTES.get(note, 0)
        target_midi = (octave + 1) * 12 + semi
        orig_midi = 69 + 12 * np.log2(f0 / 440.0)
        diff = target_midi - orig_midi
    except:
        diff = 0

    # Granular Shift
    # Small grains (20-30ms) preserve the "click" of the spoon
    y_tuned = granular_pitch_shift(y, diff, grain_size_ms=25)

    return y_tuned.astype(np.float64)

# --- 5. LEGACY GENERATORS ---

def generate_wave(note_freq, duration_sec, osc_type, cutoff_hz, resonance):
    """
    Generates a filtered waveform using 64-bit precision.
    """

    # 1. Generate 64-bit time array
    t = np.linspace(0., duration_sec, int(SAMPLE_RATE * duration_sec),
                    endpoint=False, dtype=np.float64)

    # 2. Generate 64-bit oscillator
    # (2 * pi * freq * time)
    rads = 2 * np.pi * note_freq * t

    if osc_type == 'saw':
        wave = signal.sawtooth(rads)
    elif osc_type == 'square':
        wave = signal.square(rads)
    elif osc_type == 'sine':
        wave = np.sin(rads)
    else:
        wave = np.sin(rads) # Default to sine

    # 3. Apply 64-bit Filter
    # We use a 2nd-order Butterworth filter (resonance is ignored for this)
    # Clamp cutoff to prevent errors
    cutoff_hz = max(10, min(cutoff_hz, (SAMPLE_RATE / 2) - 10))

    try:
        b, a = signal.butter(2, cutoff_hz, 'low', fs=SAMPLE_RATE)
        filtered_wave = signal.lfilter(b, a, wave).astype(np.float64)
    except Exception as e:
        # Fallback if filter fails
        print(f"Filter failed: {e}")
        filtered_wave = wave

    # 4. Apply a simple gain and return
    final_wave = filtered_wave * 0.5

    return final_wave

def generate_kick(pitch, decay, tone, volume):
    """
    Generates a kick drum sound.
    """
    length = int(SAMPLE_RATE * decay)
    t = np.linspace(0., decay, length, endpoint=False, dtype=np.float64)

    end_pitch = pitch * (1 - tone * 0.9)
    end_pitch = max(20.0, end_pitch)

    k = -np.log(end_pitch / pitch) / decay
    instant_freq = pitch * np.exp(-k * t)

    phase = 2 * np.pi * (-pitch / k) * np.exp(-k * t)

    wave = np.sin(phase)

    env = np.exp(-t / (decay * 0.33))

    kick = (wave * env * volume).astype(np.float64)
    return kick

def generate_snare(decay, tone_pitch, noise_freq, volume):
    """
    Generates a snare drum sound.
    """
    length = int(SAMPLE_RATE * decay * 1.5)
    t = np.linspace(0., decay * 1.5, length, endpoint=False, dtype=np.float64)

    tone_env = np.exp(-t / (decay * 0.5))
    tone_wave = np.sin(2 * np.pi * tone_pitch * t)
    tone_comp = tone_wave * tone_env

    noise_env = np.exp(-t / decay)
    white_noise = np.random.uniform(-1, 1, length)

    try:
        b, a = signal.butter(2, noise_freq, 'high', fs=SAMPLE_RATE)
        noise_comp = signal.lfilter(b, a, white_noise).astype(np.float64) * noise_env
    except Exception as e:
        noise_comp = white_noise * noise_env

    snare = (tone_comp * 0.3 + noise_comp * 0.7) * volume

    attack_len = int(SAMPLE_RATE * 0.005)
    attack_env = np.linspace(0, 1, attack_len)
    if length > attack_len:
        snare[:attack_len] *= attack_env

    return snare.astype(np.float64)

def generate_hat(pitch_cutoff, decay, volume):
    """
    Generates a hi-hat sound.
    """
    length = int(SAMPLE_RATE * decay)
    t = np.linspace(0., decay, length, endpoint=False, dtype=np.float64)

    white_noise = np.random.uniform(-1, 1, length)

    try:
        b, a = signal.butter(4, pitch_cutoff, 'high', fs=SAMPLE_RATE)
        filtered_noise = signal.lfilter(b, a, white_noise).astype(np.float64)
    except Exception as e:
        filtered_noise = white_noise

    env = np.exp(-t / (decay * 0.33))

    hat = (filtered_noise * env * volume).astype(np.float64)
    return hat

def generate_sampler(name, pitch_ratio, volume):
    """
    Resamples the stored sample to a new pitch.
    """
    if name not in SAMPLES:
        print(f"Sample {name} not found")
        return np.zeros(128, dtype=np.float64)

    original = SAMPLES[name]
    orig_len = len(original)

    new_len = int(orig_len / pitch_ratio)

    if new_len < 1:
        return np.zeros(128, dtype=np.float64)

    x_new = np.linspace(0, orig_len - 1, new_len)
    x_original = np.arange(orig_len)

    resampled = np.interp(x_new, x_original, original)

    final_wave = resampled * volume

    return final_wave.astype(np.float64)

# --- PHASE VOCODER & PITCH SHIFTING (Required for Harmonizer) ---

def phase_vocoder(y, rate):
    """
    Time-stretches signal 'y' by factor 'rate' using STFT Phase Vocoder.
    rate > 1.0 = Slower (Stretch) | rate < 1.0 = Faster (Compress)
    """
    n_fft = 2048
    hop_length = n_fft // 4
    spec = signal.stft(y, nperseg=n_fft, noverlap=n_fft-hop_length)[2]

    rows, cols = spec.shape
    new_cols = int(cols * rate)
    time_new = np.linspace(0, cols, new_cols)

    new_spec = np.zeros((rows, new_cols), dtype=np.complex128)
    phi_advance = np.linspace(0, np.pi * hop_length, rows)
    phase_acc = np.angle(spec[:, 0])

    for t in range(new_cols):
        old_t = time_new[t]
        idx = int(np.floor(old_t))
        alpha = old_t - idx

        # Safe indexing
        if idx >= cols - 1:
            col_0 = spec[:, -1]; col_1 = spec[:, -1]
        else:
            col_0 = spec[:, idx]; col_1 = spec[:, idx+1]

        # Mag Linear Interp
        mag = (1 - alpha) * np.abs(col_0) + alpha * np.abs(col_1)

        # Phase Prop
        phase_0 = np.angle(col_0)
        phase_1 = np.angle(col_1)
        dphase = phase_1 - phase_0 - phi_advance
        dphase -= 2 * np.pi * np.round(dphase / (2 * np.pi))
        phase_acc += dphase + phi_advance

        new_spec[:, t] = mag * np.exp(1j * phase_acc)

    _, y_stretch = signal.istft(new_spec, nperseg=n_fft, noverlap=n_fft-hop_length)
    return y_stretch

def shift_pitch_pv(y, n_semitones):
    """ Shifts pitch WITHOUT changing duration. """
    if n_semitones == 0: return y
    factor = 2 ** (n_semitones / 12.0)

    # 1. Resample (Changes pitch & duration)
    new_len = int(len(y) / factor)
    y_resampled = signal.resample(y, new_len)

    # 2. Stretch back to original length
    stretch_factor = len(y) / len(y_resampled)
    y_shifted = phase_vocoder(y_resampled, stretch_factor)

    # Trim/Pad to match exactly
    if len(y_shifted) > len(y): y_shifted = y_shifted[:len(y)]
    else: y_shifted = np.pad(y_shifted, (0, len(y) - len(y_shifted)))

    return y_shifted

# --- HARMONIZER FUNCTION ---

def generate_chord_stack(name, chord_type):
    """
    Creates a chord from a single sample.
    """
    if name not in SAMPLES: return np.zeros(10)
    y = SAMPLES[name]

    intervals = {
        'major': [0, 4, 7],
        'minor': [0, 3, 7],
        'maj7':  [0, 4, 7, 11],
        'min7':  [0, 3, 7, 10],
        'octave': [0, 12],
        'stack': [0, 7, 12]
    }

    semitones = intervals.get(chord_type, [0])
    output = np.zeros(len(y))

    # Mix layers
    for semi in semitones:
        layer = shift_pitch_pv(y, semi)
        # Prevent clipping when summing layers by scaling down
        output += layer * 0.6

    # Normalize
    max_val = np.max(np.abs(output))
    if max_val > 0: output = output / max_val

    return output.astype(np.float64)

# --- NEW: Arpeggiator Patterns ---

ARP_PATTERNS = {
    'major': [0, 4, 7, 12],
    'minor': [0, 3, 7, 12],
    'major7': [0, 4, 7, 11],
    'minor7': [0, 3, 7, 10],
    'dom7': [0, 4, 7, 10],
    'sus4': [0, 5, 7, 12],
    'octaves': [0, 12, 0, 12],
    'fifths': [0, 7, 12, 7],
    'chromatic_up': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'chromatic_down': [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
}

def get_arp_pattern(name):
    return ARP_PATTERNS.get(name, ARP_PATTERNS['major'])

def list_arp_patterns():
    return list(ARP_PATTERNS.keys())

# --- TRACK FREEZER ---

class TrackFreezer:
    """
    Helper class for rendering complex audio to a buffer (Track Freeze/Bounce).
    """
    def __init__(self, sample_rate=None):
        self.sample_rate = sample_rate or SAMPLE_RATE

    def freeze_synth_sequence(self, sequence, params):
        bpm = params.get('bpm', 120)
        steps = len(sequence)
        step_duration = 60.0 / bpm / 4
        total_duration = steps * step_duration

        total_samples = int(self.sample_rate * total_duration)
        output = np.zeros(total_samples, dtype=np.float64)

        for step_idx, step_data in enumerate(sequence):
            if step_data is None:
                continue

            note = step_data.get('note', 'C4')
            velocity = step_data.get('velocity', 1.0)
            length = step_data.get('length', 1)

            start_sample = int(step_idx * step_duration * self.sample_rate)
            note_duration = length * step_duration

            note_freq = self._note_to_freq(note)
            osc_type = params.get('waveform', 'saw')
            cutoff = params.get('filterCutoff', 4000)
            resonance = params.get('filterResonance', 0)

            wave = generate_wave(note_freq, note_duration, osc_type, cutoff, resonance)
            wave *= velocity

            attack = params.get('attack', 0.01)
            decay = params.get('decay', 0.1)
            sustain = params.get('sustain', 0.7)
            release = params.get('release', 0.2)

            wave = self._apply_adsr(wave, attack, decay, sustain, release, note_duration)

            end_sample = min(start_sample + len(wave), total_samples)
            actual_len = end_sample - start_sample
            output[start_sample:end_sample] += wave[:actual_len]

        max_val = np.max(np.abs(output))
        if max_val > 1.0:
            output /= max_val

        return output

    def freeze_drum_pattern(self, pattern, params, drum_type='kick'):
        bpm = params.get('bpm', 120)
        steps = len(pattern)
        step_duration = 60.0 / bpm / 4
        total_duration = steps * step_duration

        total_samples = int(self.sample_rate * total_duration)
        output = np.zeros(total_samples, dtype=np.float64)

        for step_idx, step_data in enumerate(pattern):
            if step_data is None:
                continue

            velocity = step_data.get('velocity', 1.0)
            start_sample = int(step_idx * step_duration * self.sample_rate)

            if drum_type == 'kick':
                hit = generate_kick(
                    params.get('pitch', 60),
                    params.get('decay', 0.5),
                    params.get('tone', 0.5),
                    params.get('volume', 0.8) * velocity
                )
            elif drum_type == 'snare':
                hit = generate_snare(
                    params.get('decay', 0.3),
                    params.get('tone', 200),
                    params.get('noise', 5000),
                    params.get('volume', 0.7) * velocity
                )
            else:
                hit = generate_hat(
                    params.get('pitch', 10000),
                    params.get('decay', 0.1),
                    params.get('volume', 0.6) * velocity
                )

            end_sample = min(start_sample + len(hit), total_samples)
            actual_len = end_sample - start_sample
            output[start_sample:end_sample] += hit[:actual_len]

        return output

    def _note_to_freq(self, note_name):
        notes = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
        note = note_name[0].upper()
        octave = int(note_name[-1])

        modifier = 0
        if len(note_name) > 2:
            if note_name[1] == '#':
                modifier = 1
            elif note_name[1] == 'b':
                modifier = -1

        semitone = notes[note] + modifier
        midi_num = (octave + 1) * 12 + semitone
        return 440.0 * (2 ** ((midi_num - 69) / 12))

    def _apply_adsr(self, wave, attack, decay, sustain, release, duration):
        length = len(wave)
        env = np.ones(length, dtype=np.float64)

        attack_samples = int(attack * self.sample_rate)
        decay_samples = int(decay * self.sample_rate)
        release_samples = int(release * self.sample_rate)

        if attack_samples > 0:
            attack_samples = min(attack_samples, length)
            env[:attack_samples] = np.linspace(0, 1, attack_samples)

        decay_start = attack_samples
        decay_end = min(decay_start + decay_samples, length)
        if decay_end > decay_start:
            env[decay_start:decay_end] = np.linspace(1, sustain, decay_end - decay_start)

        if decay_end < length:
            env[decay_end:] = sustain

        release_start = max(0, length - release_samples)
        if release_samples > 0 and release_start < length:
            env[release_start:] *= np.linspace(1, 0, length - release_start)

        return wave * env

track_freezer = TrackFreezer()

def freeze_synth_track(sequence_json, params_json):
    import json
    if isinstance(sequence_json, str):
        sequence = json.loads(sequence_json)
    else:
        sequence = list(sequence_json)

    if isinstance(params_json, str):
        params = json.loads(params_json)
    else:
        params = dict(params_json)

    return track_freezer.freeze_synth_sequence(sequence, params)

def freeze_drum_track(pattern_json, params_json, drum_type='kick'):
    import json
    if isinstance(pattern_json, str):
        pattern = json.loads(pattern_json)
    else:
        pattern = list(pattern_json)

    if isinstance(params_json, str):
        params = json.loads(params_json)
    else:
        params = dict(params_json)

    return track_freezer.freeze_drum_pattern(pattern, params, drum_type)
`;

// 3. The Initialization Function
globalThis.initPyodideSystem = async function() {
    if (globalThis.hyphonPyodideLoading) return;
    globalThis.hyphonPyodideLoading = true;

    console.log("[C++ -> JS] Requesting Pyodide Load...");

    try {
        // Load the Pyodide script dynamically if not present
        if (!globalThis.loadPyodide) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js";
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        // Initialize Pyodide
        const pyodide = await globalThis.loadPyodide();

        // Load the internal python code
        await pyodide.runPythonAsync(INTERNAL_PYTHON_CODE);

        globalThis.hyphonPyodide = pyodide;
        globalThis.hyphonPyodideReady = true;

        // Dispatch an event so React knows we are ready
        window.dispatchEvent(new CustomEvent('hyphon-pyodide-ready'));
        console.log("[C++ -> JS] Pyodide Ready.");

    } catch (e) {
        console.error("[C++ -> JS] Pyodide Load Failed:", e);
        // Mark as "ready" even on failure so the app doesn't hang
        globalThis.hyphonPyodideReady = false;
        globalThis.hyphonPyodideLoading = false;
    }
};

// Automatically initialize Pyodide after WASM module loads
// Only run in main thread (not in worker threads)
if (!globalThis.WorkerGlobalScope && globalThis.window) {
    // Use setTimeout to ensure this runs after the module export completes
    setTimeout(() => {
        if (typeof globalThis.initPyodideSystem === 'function') {
            globalThis.initPyodideSystem();
        }
    }, 0);
}
