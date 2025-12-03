
/* eslint-disable no-restricted-globals */

// This worker handles the Python environment (Pyodide)
// It loads numpy/scipy and exposes generation functions.

let pyodide: any = null;
let isReady = false;

// The Python Code (Same as original, moved here)
const pythonCode = `
import numpy as np
from scipy import signal

# We must match the sample rate of the browser's AudioContext
SAMPLE_RATE = 44100

def set_sample_rate(rate):
    global SAMPLE_RATE
    SAMPLE_RATE = int(rate)
    # print(f"Python sample rate set to: {SAMPLE_RATE}")

def generate_wave(note_freq, duration_sec, osc_type, cutoff_hz, resonance):
    # 1. Generate 64-bit time array
    t = np.linspace(0., duration_sec, int(SAMPLE_RATE * duration_sec),
                    endpoint=False, dtype=np.float64)

    # 2. Generate 64-bit oscillator
    rads = 2 * np.pi * note_freq * t

    if osc_type == 'saw':
        wave = signal.sawtooth(rads)
    elif osc_type == 'square':
        wave = signal.square(rads)
    elif osc_type == 'sine':
        wave = np.sin(rads)
    else:
        wave = np.sin(rads)

    # 3. Apply 64-bit Filter
    cutoff_hz = max(10, min(cutoff_hz, (SAMPLE_RATE / 2) - 10))

    try:
        b, a = signal.butter(2, cutoff_hz, 'low', fs=SAMPLE_RATE)
        filtered_wave = signal.lfilter(b, a, wave).astype(np.float64)
    except Exception as e:
        print(f"Filter failed: {e}")
        filtered_wave = wave

    final_wave = filtered_wave * 0.5
    return final_wave.astype(np.float32)

def generate_kick(pitch, decay, tone, volume):
    length = int(SAMPLE_RATE * decay)
    t = np.linspace(0., decay, length, endpoint=False, dtype=np.float64)

    end_pitch = pitch * (1 - tone * 0.9)
    end_pitch = max(20.0, end_pitch)

    k = -np.log(end_pitch / pitch) / decay
    instant_freq = pitch * np.exp(-k * t)

    phase = 2 * np.pi * (-pitch / k) * np.exp(-k * t)
    wave = np.sin(phase)
    env = np.exp(-t / (decay * 0.33))

    kick = (wave * env * volume).astype(np.float32)
    return kick

def generate_snare(decay, tone_pitch, noise_freq, volume):
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

    return snare.astype(np.float32)

def generate_hat(pitch_cutoff, decay, volume):
    length = int(SAMPLE_RATE * decay)
    t = np.linspace(0., decay, length, endpoint=False, dtype=np.float64)

    white_noise = np.random.uniform(-1, 1, length)

    try:
        b, a = signal.butter(4, pitch_cutoff, 'high', fs=SAMPLE_RATE)
        filtered_noise = signal.lfilter(b, a, white_noise).astype(np.float64)
    except Exception as e:
        filtered_noise = white_noise

    env = np.exp(-t / (decay * 0.33))

    hat = (filtered_noise * env * volume).astype(np.float32)
    return hat

SAMPLES = {}

def load_sample(name, data):
    try:
        SAMPLES[name] = np.array(data, dtype=np.float64)
        print(f"Sample '{name}' loaded. Length: {len(SAMPLES[name])}")
    except Exception as e:
        print(f"Error loading sample {name}: {e}")

def generate_sampler(name, pitch_ratio, volume):
    if name not in SAMPLES:
        return np.zeros(128, dtype=np.float32)

    original = SAMPLES[name]
    orig_len = len(original)
    new_len = int(orig_len / pitch_ratio)

    if new_len < 1:
        return np.zeros(128, dtype=np.float32)

    x_new = np.linspace(0, orig_len - 1, new_len)
    x_original = np.arange(orig_len)

    resampled = np.interp(x_new, x_original, original)
    final_wave = resampled * volume

    return final_wave.astype(np.float32)
`;

const loadPyodideEnvironment = async () => {
    try {
        // ImportScripts is standard in workers
        importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js");

        // @ts-ignore
        pyodide = await loadPyodide();
        await pyodide.loadPackage(['numpy', 'scipy']);
        await pyodide.runPythonAsync(pythonCode);

        isReady = true;
        self.postMessage({ type: 'ready' });
    } catch (e: any) {
        console.error("Worker Pyodide Init Failed:", e);
        self.postMessage({ type: 'error', error: e.toString() });
    }
};

self.onmessage = async (e) => {
    const { type, id, params } = e.data;

    if (type === 'init') {
        await loadPyodideEnvironment();
        return;
    }

    if (!isReady || !pyodide) {
        // Return empty if not ready (or error)
        if (id) self.postMessage({ id, error: "Pyodide not ready" });
        return;
    }

    try {
        if (type === 'generate_wave') {
            const { freq, duration, oscType, cutoff, resonance, sampleRate } = params;
            // Set sample rate if needed (optimization: only if changed)
            pyodide.globals.get('set_sample_rate')(sampleRate);

            const pyProxy = pyodide.globals.get('generate_wave')(freq, duration, oscType, cutoff, resonance);
            const data = pyProxy.toJs({ array_buffer_type: "float32" });
            pyProxy.destroy();

            self.postMessage({ id, data }, [data.buffer]);
        }
        else if (type === 'generate_kick') {
            const { pitch, decay, tone, volume, sampleRate } = params;
            pyodide.globals.get('set_sample_rate')(sampleRate);

            const pyProxy = pyodide.globals.get('generate_kick')(pitch, decay, tone, volume);
            const data = pyProxy.toJs({ array_buffer_type: "float32" });
            pyProxy.destroy();

            self.postMessage({ id, data }, [data.buffer]);
        }
        else if (type === 'generate_snare') {
            const { decay, tone, noise, volume, sampleRate } = params;
            pyodide.globals.get('set_sample_rate')(sampleRate);

            const pyProxy = pyodide.globals.get('generate_snare')(decay, tone, noise, volume);
            const data = pyProxy.toJs({ array_buffer_type: "float32" });
            pyProxy.destroy();

            self.postMessage({ id, data }, [data.buffer]);
        }
        else if (type === 'generate_hat') {
            const { pitch, decay, volume, sampleRate } = params;
            pyodide.globals.get('set_sample_rate')(sampleRate);

            const pyProxy = pyodide.globals.get('generate_hat')(pitch, decay, volume);
            const data = pyProxy.toJs({ array_buffer_type: "float32" });
            pyProxy.destroy();

            self.postMessage({ id, data }, [data.buffer]);
        }
        else if (type === 'load_sample') {
            const { name, data } = params;
            // Data is passed as typed array, Pyodide can handle it
            // We need to convert Float32Array to list or numpy array
            // pyodide.toPy(data) might work or use globals
            // Best to use load_sample which expects a list or array
            // Converting Float32Array to standard array might be heavy if large?
            // Pyodide handles TypedArrays well.
            pyodide.globals.get('load_sample')(name, data);
        }
        else if (type === 'generate_sampler') {
            const { name, ratio, volume } = params;
            const pyProxy = pyodide.globals.get('generate_sampler')(name, ratio, volume);
            const data = pyProxy.toJs({ array_buffer_type: "float32" });
            pyProxy.destroy();
            self.postMessage({ id, data }, [data.buffer]);
        }
    } catch (err: any) {
        console.error(`Worker Error (${type}):`, err);
        if (id) self.postMessage({ id, error: err.toString() });
    }
};

export {};
