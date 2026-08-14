export function createTTSWorkerBlob(): string {
    const workerCode = `
        // TTS Worker for parallel text-to-speech generation
        let synth = null;

        // Initialize speech synthesis if available
        if (typeof self !== 'undefined' && 'speechSynthesis' in self) {
            synth = self.speechSynthesis;
        }

        self.onmessage = function(event) {
            const { type, id, data } = event.data;

            switch (type) {
                case 'init':
                    self.postMessage({ type: 'ready', id });
                    break;

                case 'tts':
                case 'generate':
                    handleTTS(id, data);
                    break;

                case 'process':
                    handleProcess(id, data);
                    break;

                case 'pitch':
                    handlePitchShift(id, data);
                    break;

                default:
                    self.postMessage({
                        type: 'error',
                        id,
                        error: 'Unknown task type: ' + type
                    });
            }
        };

        function handleTTS(id, data) {
            try {
                const { text, pitch = 1.0, rate = 1.0 } = data || {};

                if (!synth) {
                    // Fallback: generate placeholder audio data
                    const sampleRate = 22050;
                    const duration = (text?.length || 10) * 0.1; // Rough estimate
                    const samples = Math.floor(sampleRate * duration);
                    const audio = new Float32Array(samples);

                    // Generate simple waveform as placeholder
                    for (let i = 0; i < samples; i++) {
                        const t = i / sampleRate;
                        audio[i] = Math.sin(2 * Math.PI * 440 * pitch * t) * 0.1;
                        // Add envelope
                        if (t < 0.01) audio[i] *= t / 0.01;
                        if (t > duration - 0.01) audio[i] *= (duration - t) / 0.01;
                    }

                    self.postMessage({
                        type: 'result',
                        id,
                        data: { audio, sampleRate, text }
                    }, [audio.buffer]);
                    return;
                }

                // Use Web Speech API
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.pitch = pitch;
                utterance.rate = rate;

                // Note: Actual audio buffer extraction from Web Speech API
                // requires MediaRecorder or AudioWorklet capture on main thread
                // This is a simplified implementation

                utterance.onend = () => {
                    self.postMessage({
                        type: 'result',
                        id,
                        data: { text, pitch, rate, completed: true }
                    });
                };

                utterance.onerror = (e) => {
                    self.postMessage({
                        type: 'error',
                        id,
                        error: e.error
                    });
                };

                synth.speak(utterance);
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
        }

        function handleProcess(id, data) {
            try {
                const { buffer, operation } = data || {};

                if (!buffer || !(buffer instanceof Float32Array)) {
                    throw new Error('Invalid buffer data');
                }

                const result = new Float32Array(buffer.length);

                switch (operation) {
                    case 'normalize':
                        let max = 0;
                        for (let i = 0; i < buffer.length; i++) {
                            const abs = Math.abs(buffer[i]);
                            if (abs > max) max = abs;
                        }
                        const scale = max > 0 ? 1 / max : 1;
                        for (let i = 0; i < buffer.length; i++) {
                            result[i] = buffer[i] * scale;
                        }
                        break;

                    case 'fadeIn':
                        const fadeInLength = Math.min(buffer.length, Math.floor(0.01 * 44100));
                        for (let i = 0; i < buffer.length; i++) {
                            const gain = i < fadeInLength ? i / fadeInLength : 1;
                            result[i] = buffer[i] * gain;
                        }
                        break;

                    case 'fadeOut':
                        const fadeOutLength = Math.min(buffer.length, Math.floor(0.01 * 44100));
                        for (let i = 0; i < buffer.length; i++) {
                            const gain = i >= buffer.length - fadeOutLength
                                ? (buffer.length - i) / fadeOutLength
                                : 1;
                            result[i] = buffer[i] * gain;
                        }
                        break;

                    default:
                        result.set(buffer);
                }

                self.postMessage({
                    type: 'result',
                    id,
                    data: { result, operation }
                }, [result.buffer]);
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
        }

        function handlePitchShift(id, data) {
            try {
                const { buffer, ratio, sampleRate = 44100 } = data || {};

                if (!buffer || !(buffer instanceof Float32Array)) {
                    throw new Error('Invalid buffer data');
                }

                // Simple time-domain pitch shift using resampling
                // For production, use Rubber Band or similar
                const outputLength = Math.floor(buffer.length / ratio);
                const result = new Float32Array(outputLength);

                for (let i = 0; i < outputLength; i++) {
                    const sourceIndex = i * ratio;
                    const index1 = Math.floor(sourceIndex);
                    const index2 = Math.min(index1 + 1, buffer.length - 1);
                    const frac = sourceIndex - index1;

                    result[i] = buffer[index1] * (1 - frac) + buffer[index2] * frac;
                }

                self.postMessage({
                    type: 'result',
                    id,
                    data: { result, ratio, sampleRate }
                }, [result.buffer]);
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
        }

        // Signal ready on load
        self.postMessage({ type: 'ready' });
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}
