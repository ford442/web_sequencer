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
        setPyodideStatus('Python Engine Failed to Load.');
      }
    };

    loadPyodide();
  }, []); // Empty dep array ensures this runs once on mount

  return { pyodide, isPyodideReady, pyodideStatus };
};
