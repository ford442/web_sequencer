import { useState, useEffect, useRef } from 'react';

// This hook encapsulates all Pyodide loading logic
export const usePyodideEngine = () => {
    const [pyodide, setPyodide] = useState<any | null>(null);
    const [isPyodideReady, setIsPyodideReady] = useState(false);
    const [pyodideStatus, setPyodideStatus] = useState('Loading Python Engine...');
    const pyodideLoading = useRef(false);

    // This is the Python code we will load
    const pythonCode = `
import numpy as np
from scipy import signal

# We must match the sample rate of the browser's AudioContext
# This will be set from JavaScript
SAMPLE_RATE = 44100 

def set_sample_rate(rate):
    global SAMPLE_RATE
    SAMPLE_RATE = int(rate)
    print(f"Python sample rate set to: {SAMPLE_RATE}")

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

# --- NEW: Drum Synthesis Functions ---

def generate_kick(pitch, decay, tone, volume):
    """
    Generates a kick drum sound.
    - pitch: Starting frequency in Hz
    - decay: Duration in seconds
    - tone: Controls pitch envelope depth (0.0 to 1.0)
    - volume: Final gain
    """
    length = int(SAMPLE_RATE * decay)
    t = np.linspace(0., decay, length, endpoint=False, dtype=np.float64)
    
    # 1. Pitch Envelope: Exponential decay from start pitch to a low-end
    end_pitch = pitch * (1 - tone * 0.9) # Tone controls how low the pitch drops
    end_pitch = max(20.0, end_pitch) # Keep it above 20Hz
    
    # Generate instantaneous frequency: pitch * exp(-k*t)
    # We solve for k: end_pitch = pitch * exp(-k*decay) => k = -ln(end_pitch/pitch) / decay
    k = -np.log(end_pitch / pitch) / decay
    instant_freq = pitch * np.exp(-k * t)
    
    # 2. Convert frequency to phase
    # (2 * pi * integral(f(t) dt))
    # integral(pitch * exp(-k*t) dt) = -pitch/k * exp(-k*t)
    phase = 2 * np.pi * (-pitch / k) * np.exp(-k * t)
    
    # 3. Oscillator
    wave = np.sin(phase)
    
    # 4. Amplitude Envelope
    # Simple exponential decay
    env = np.exp(-t / (decay * 0.33))
    
    kick = (wave * env * volume).astype(np.float64)
    return kick

def generate_snare(decay, tone_pitch, noise_freq, volume):
    """
    Generates a snare drum sound.
    - decay: Duration in seconds
    - tone_pitch: Pitch of the 'body'
    - noise_freq: Cutoff for the noise 'snap'
    - volume: Final gain
    """
    length = int(SAMPLE_RATE * decay * 1.5) # A bit longer for the noise tail
    t = np.linspace(0., decay * 1.5, length, endpoint=False, dtype=np.float64)
    
    # 1. Tonal Component
    tone_env = np.exp(-t / (decay * 0.5))
    tone_wave = np.sin(2 * np.pi * tone_pitch * t)
    tone_comp = tone_wave * tone_env
    
    # 2. Noise Component
    noise_env = np.exp(-t / decay)
    
    # Generate white noise
    white_noise = np.random.uniform(-1, 1, length)
    
    # Filter noise
    try:
        b, a = signal.butter(2, noise_freq, 'high', fs=SAMPLE_RATE)
        noise_comp = signal.lfilter(b, a, white_noise).astype(np.float64) * noise_env
    except Exception as e:
        noise_comp = white_noise * noise_env # Fallback
        
    # 3. Combine
    snare = (tone_comp * 0.3 + noise_comp * 0.7) * volume
    
    # Apply a sharp initial attack
    attack_len = int(SAMPLE_RATE * 0.005)
    attack_env = np.linspace(0, 1, attack_len)
    if length > attack_len:
        snare[:attack_len] *= attack_env
        
    return snare.astype(np.float64)

def generate_hat(pitch_cutoff, decay, volume):
    """
    Generates a hi-hat sound.
    - pitch_cutoff: High-pass filter cutoff
    - decay: Duration in seconds
    - volume: Final gain
    """
    length = int(SAMPLE_RATE * decay)
    t = np.linspace(0., decay, length, endpoint=False, dtype=np.float64)
    
    # 1. Noise
    white_noise = np.random.uniform(-1, 1, length)
    
    # 2. Filter
    try:
        b, a = signal.butter(4, pitch_cutoff, 'high', fs=SAMPLE_RATE)
        filtered_noise = signal.lfilter(b, a, white_noise).astype(np.float64)
    except Exception as e:
        filtered_noise = white_noise # Fallback
        
    # 3. Envelope
    env = np.exp(-t / (decay * 0.33))
    
    hat = (filtered_noise * env * volume).astype(np.float64)
    return hat

# --- NEW: Sampler Functions ---

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

def generate_sampler(name, pitch_ratio, volume):
    """
    Resamples the stored sample to a new pitch.
    - name: key in SAMPLES
    - pitch_ratio: 1.0 = original speed, 2.0 = octave up (half duration)
    - volume: gain
    """
    if name not in SAMPLES:
        print(f"Sample {name} not found")
        return np.zeros(128, dtype=np.float64) # Return silence

    original = SAMPLES[name]
    orig_len = len(original)

    # Calculate new length
    # Higher pitch = faster playback = shorter length
    new_len = int(orig_len / pitch_ratio)

    if new_len < 1:
        return np.zeros(128, dtype=np.float64)

    # Interpolation
    # We want to map [0 ... new_len-1] to [0 ... orig_len-1]
    x_new = np.linspace(0, orig_len - 1, new_len)
    x_original = np.arange(orig_len)

    # Linear interpolation is fast and sounds "okay"
    resampled = np.interp(x_new, x_original, original)

    # Apply volume
    final_wave = resampled * volume

    return final_wave.astype(np.float64)

# --- NEW: Arpeggiator Patterns ---

ARP_PATTERNS = {
    'major': [0, 4, 7, 12],           # Major triad + octave
    'minor': [0, 3, 7, 12],           # Minor triad + octave
    'major7': [0, 4, 7, 11],          # Major 7th
    'minor7': [0, 3, 7, 10],          # Minor 7th
    'dom7': [0, 4, 7, 10],            # Dominant 7th
    'sus4': [0, 5, 7, 12],            # Suspended 4th
    'octaves': [0, 12, 0, 12],        # Octave bounce
    'fifths': [0, 7, 12, 7],          # Power chord pattern
    'chromatic_up': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'chromatic_down': [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
}

def get_arp_pattern(name):
    """Returns an arp pattern by name."""
    return ARP_PATTERNS.get(name, ARP_PATTERNS['major'])

def list_arp_patterns():
    """Returns list of available arp pattern names."""
    return list(ARP_PATTERNS.keys())

# --- NEW: Track Freezer (Offline Rendering) ---

class TrackFreezer:
    """
    Helper class for rendering complex audio to a buffer (Track Freeze/Bounce).
    Uses OfflineAudioContext concept - but in Python we just synthesize directly.
    """
    def __init__(self, sample_rate=None):
        self.sample_rate = sample_rate or SAMPLE_RATE
    
    def freeze_synth_sequence(self, sequence, params):
        """
        Renders a synth sequence to a single audio buffer.
        
        Args:
            sequence: List of step data [{'note': 'C4', 'velocity': 1, 'length': 1}, None, ...]
            params: Dict with synth parameters (waveform, cutoff, etc.)
        
        Returns:
            numpy array of the rendered audio
        """
        # Calculate total duration based on sequence length and tempo
        bpm = params.get('bpm', 120)
        steps = len(sequence)
        step_duration = 60.0 / bpm / 4  # Duration of one 16th note
        total_duration = steps * step_duration
        
        total_samples = int(self.sample_rate * total_duration)
        output = np.zeros(total_samples, dtype=np.float64)
        
        # Render each note
        for step_idx, step_data in enumerate(sequence):
            if step_data is None:
                continue
            
            note = step_data.get('note', 'C4')
            velocity = step_data.get('velocity', 1.0)
            length = step_data.get('length', 1)
            
            # Calculate note timing
            start_sample = int(step_idx * step_duration * self.sample_rate)
            note_duration = length * step_duration
            
            # Generate the note
            note_freq = self._note_to_freq(note)
            osc_type = params.get('waveform', 'saw')
            cutoff = params.get('filterCutoff', 4000)
            resonance = params.get('filterResonance', 0)
            
            wave = generate_wave(note_freq, note_duration, osc_type, cutoff, resonance)
            wave *= velocity
            
            # Apply envelope
            attack = params.get('attack', 0.01)
            decay = params.get('decay', 0.1)
            sustain = params.get('sustain', 0.7)
            release = params.get('release', 0.2)
            
            wave = self._apply_adsr(wave, attack, decay, sustain, release, note_duration)
            
            # Mix into output
            end_sample = min(start_sample + len(wave), total_samples)
            actual_len = end_sample - start_sample
            output[start_sample:end_sample] += wave[:actual_len]
        
        # Normalize to prevent clipping
        max_val = np.max(np.abs(output))
        if max_val > 1.0:
            output /= max_val
        
        return output
    
    def freeze_drum_pattern(self, pattern, params, drum_type='kick'):
        """
        Renders a drum pattern to a single audio buffer.
        """
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
            
            # Generate drum hit
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
            else:  # hat
                hit = generate_hat(
                    params.get('pitch', 10000),
                    params.get('decay', 0.1),
                    params.get('volume', 0.6) * velocity
                )
            
            # Mix into output
            end_sample = min(start_sample + len(hit), total_samples)
            actual_len = end_sample - start_sample
            output[start_sample:end_sample] += hit[:actual_len]
        
        return output
    
    def _note_to_freq(self, note_name):
        """Convert note name like 'C4' to frequency."""
        notes = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
        note = note_name[0].upper()
        octave = int(note_name[-1])
        
        # Handle sharps/flats
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
        """Apply ADSR envelope to wave."""
        length = len(wave)
        env = np.ones(length, dtype=np.float64)
        
        attack_samples = int(attack * self.sample_rate)
        decay_samples = int(decay * self.sample_rate)
        release_samples = int(release * self.sample_rate)
        
        # Attack
        if attack_samples > 0:
            attack_samples = min(attack_samples, length)
            env[:attack_samples] = np.linspace(0, 1, attack_samples)
        
        # Decay
        decay_start = attack_samples
        decay_end = min(decay_start + decay_samples, length)
        if decay_end > decay_start:
            env[decay_start:decay_end] = np.linspace(1, sustain, decay_end - decay_start)
        
        # Sustain (already at sustain level from decay)
        if decay_end < length:
            env[decay_end:] = sustain
        
        # Release
        release_start = max(0, length - release_samples)
        if release_samples > 0 and release_start < length:
            env[release_start:] *= np.linspace(1, 0, length - release_start)
        
        return wave * env

# Create global freezer instance
track_freezer = TrackFreezer()

def freeze_synth_track(sequence_json, params_json):
    """
    API function callable from JS to freeze a synth track.
    sequence_json and params_json should be JSON strings or dicts.
    """
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
    """
    API function callable from JS to freeze a drum track.
    """
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

    // Helper function to dynamically load the Pyodide script
    const loadScript = (src: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script ${src}`));
            document.head.appendChild(script);
        });
    };

    useEffect(() => {
        // Ensure this runs only once
        if (pyodideLoading.current || pyodide) return;
        pyodideLoading.current = true;

        const loadPyodide = async () => {
            try {
                setPyodideStatus('Loading Pyodide runtime...');
                await loadScript("https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js");

                // @ts-ignore: loadPyodide is now on the window object
                const pyodideInstance = await window.loadPyodide();
                setPyodide(pyodideInstance);

                setPyodideStatus('Loading numpy & scipy...');
                await pyodideInstance.loadPackage(['numpy', 'scipy']);

                setPyodideStatus('Loading Python synth code...');
                await pyodideInstance.runPythonAsync(pythonCode);

                setPyodideStatus('Python Engine Ready!');
                setIsPyodideReady(true);
                setTimeout(() => setPyodideStatus(''), 2000); // Clear status after 2s
            } catch (e) {
                console.error("Failed to load Pyodide:", e);
                setPyodideStatus('Python Engine Failed to Load (Simulating Mode).');
                // Fallback: Allow UI to be interactive even if engine fails (e.g. offline dev)
                // We set ready to true so the UI exits loading state.
                setIsPyodideReady(true);
            }
        };

        loadPyodide();
    }, []); // Empty dep array ensures this runs once on mount

    return { pyodide, isPyodideReady, pyodideStatus };
};
