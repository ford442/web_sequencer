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

# --- NEW: Analysis Functions ---
# The analyze_sample function is now provided by the audio_proc wheel.
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

        setPyodideStatus('Loading Audio Analysis Engine...');
        await pyodideInstance.loadPackage('micropip');
        const micropip = pyodideInstance.pyimport('micropip');
        
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
