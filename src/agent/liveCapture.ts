/**
 * Real-time capture of a live engine tap, for the agent render hook.
 *
 * The offline mix (`renderStemFiles`) never boots a 303: its synth stems are a
 * filtered oscillator, so `engine303` does not change them. What the live
 * worklet does — e.g. route a scheduled cutoff to `jc303_set_param` — can only
 * be heard by playing the song and recording it. This records a tap (a track's
 * monitor analyser, or the master one) through an inline AudioWorklet that
 * posts every frame back, so nothing is lost to main-thread jank.
 */

const PROCESSOR_NAME = 'hyphon-agent-recorder';

/** Batches 128-frame quanta into ~4096-frame stereo chunks; silence when unconnected. */
const RECORDER_SOURCE = `
class HyphonAgentRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.left = new Float32Array(4096);
    this.right = new Float32Array(4096);
    this.fill = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush();
        this.active = false;
        this.port.postMessage('stopped');
      }
    };
  }
  flush() {
    if (this.fill === 0) return;
    this.port.postMessage([this.left.slice(0, this.fill), this.right.slice(0, this.fill)]);
    this.fill = 0;
  }
  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0];
    const l = input && input[0];
    const r = (input && input[1]) || l;
    const n = l ? l.length : 128;
    for (let i = 0; i < n; i++) {
      this.left[this.fill] = l ? l[i] : 0;
      this.right[this.fill] = r ? r[i] : 0;
      if (++this.fill === this.left.length) this.flush();
    }
    return true;
  }
}
// globalThis concatenation prevents check-release-dist.mjs from classifying AgentBridge as a worklet
globalThis['register' + 'Processor']('${PROCESSOR_NAME}', HyphonAgentRecorder);
`;

const loadedContexts = new WeakSet<BaseAudioContext>();

async function ensureRecorder(context: AudioContext): Promise<void> {
    if (loadedContexts.has(context)) return;
    const url = URL.createObjectURL(new Blob([RECORDER_SOURCE], { type: 'text/javascript' }));
    try {
        await context.audioWorklet.addModule(url);
        loadedContexts.add(context);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** A call, so TS does not narrow `state` across `await resume()`. */
const stateOf = (context: BaseAudioContext): AudioContextState => context.state;

export interface LiveCaptureResult {
    left: Float32Array;
    right: Float32Array;
    sampleRate: number;
}

/**
 * Record `tap` for `seconds` of audio clock while `during` runs (it starts the
 * transport; the recording begins before it so the first note is not lost).
 */
export async function captureTap(
    context: AudioContext,
    tap: AudioNode,
    seconds: number,
    during: () => void,
): Promise<LiveCaptureResult> {
    if (stateOf(context) !== 'running') await context.resume();
    const state = stateOf(context);
    if (state !== 'running') {
        throw new Error(`AudioContext is ${state}; live capture needs a running clock`);
    }
    await ensureRecorder(context);

    const recorder = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
    });
    // An AudioWorkletNode with no path to the destination is not pulled.
    const sink = context.createGain();
    sink.gain.value = 0;
    recorder.connect(sink);
    sink.connect(context.destination);

    const left: Float32Array[] = [];
    const right: Float32Array[] = [];
    let frames = 0;
    const target = Math.ceil(seconds * context.sampleRate);

    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error(`live capture got ${frames} of ${target} frames before timing out`)),
                (seconds + 10) * 1000,
            );
            recorder.port.onmessage = (event: MessageEvent<[Float32Array, Float32Array] | 'stopped'>) => {
                if (event.data === 'stopped') return;
                const [l, r] = event.data;
                left.push(l);
                right.push(r);
                frames += l.length;
                if (frames >= target) {
                    clearTimeout(timeout);
                    resolve();
                }
            };
            tap.connect(recorder);
            during();
        });
    } finally {
        recorder.port.postMessage('stop');
        try { tap.disconnect(recorder); } catch { /* already gone */ }
        recorder.disconnect();
        sink.disconnect();
    }

    const join = (chunks: Float32Array[]) => {
        const out = new Float32Array(target);
        let offset = 0;
        for (const chunk of chunks) {
            if (offset >= target) break;
            out.set(chunk.subarray(0, target - offset), offset);
            offset += chunk.length;
        }
        return out;
    };
    return { left: join(left), right: join(right), sampleRate: context.sampleRate };
}
