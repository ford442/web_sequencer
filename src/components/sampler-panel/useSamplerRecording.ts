import { useRef, useState, useCallback, useEffect } from 'react';
import type { RecordingInput } from '../../utils/audioInputDevice';
import { ensureRunning } from '../../audio/runtime/AudioRuntime';
import { RecordingUnsupportedError, recordingSupport } from '../../audio/recording/recordingSupport';
import type { TakeSession } from '../../audio/recording/takeRecorder';

/** The recorder (worker, worklet, WAV decoder) and the input code load on the first REC, not with the panel. */
const loadRecorder = () => import('../../audio/recording/takeRecorder');
const loadInput = () => import('../../utils/audioInputDevice');

/**
 * Record into the active sampler bank (#1498 P1): the raw input (no echo
 * cancellation, noise suppression or auto gain) goes through the take
 * recorder into a lossless float WAV in OPFS, which is decoded once into the
 * bank and then deleted. No MediaRecorder and no webm: a browser that cannot
 * record says why.
 */
export function useSamplerRecording(
  audioContext: AudioContext,
  onRecorded: (buffer: AudioBuffer) => void,
) {
  const [isRecording, setIsRecording] = useState(false);
  const sessionRef = useRef<{ take: TakeSession; input: RecordingInput } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => () => {
    // Unmounted mid-take: drop it rather than leave the mic open.
    const current = sessionRef.current;
    sessionRef.current = null;
    if (current) {
      void current.take.abort().catch(() => undefined);
      current.input.close();
    }
  }, []);

  const toggleRecording = useCallback(async (setStatus: (s: string) => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const current = sessionRef.current;
      if (current) {
        sessionRef.current = null;
        setIsRecording(false);
        setStatus('Processing...');
        try {
          const { decodeTake, discardTake, toAudioBuffer } = await loadRecorder();
          const meta = await current.take.stop();
          const buffer = toAudioBuffer(await decodeTake(meta.id));
          onRecorded(buffer);
          setStatus(meta.droppedFrames > 0 ? `Recorded (${meta.droppedFrames} frames lost)` : 'Recorded!');
          await discardTake(meta.id).catch(() => undefined);
        } catch (err) {
          console.warn('[sampler] recording failed:', err);
          setStatus('Record Error');
        } finally {
          current.input.close();
        }
        return;
      }

      const support = recordingSupport();
      if (!support.ok) {
        setStatus(`Rec unsupported: ${support.reason}`);
        return;
      }
      let input: RecordingInput;
      try {
        input = await (await loadInput()).openRecordingInput();
      } catch {
        setStatus('Mic Error');
        return;
      }
      try {
        // REC is a click: the take's clock has to run.
        if (audioContext.state !== 'running') await ensureRunning('click', audioContext);
        const { startTake } = await loadRecorder();
        const take = await startTake({ context: audioContext, input, purpose: 'sampler' });
        sessionRef.current = { take, input };
        setIsRecording(true);
        setStatus(input.keptProcessing.length ? `Recording (browser kept ${input.keptProcessing.join(', ')})` : 'Recording...');
      } catch (err) {
        input.close();
        setStatus(err instanceof RecordingUnsupportedError ? `Rec unsupported: ${err.message.replace(/^Recording is not supported here: /, '')}` : 'Record Error');
        if (!(err instanceof RecordingUnsupportedError)) console.warn('[sampler] could not start recording:', err);
      }
    } finally {
      busyRef.current = false;
    }
  }, [audioContext, onRecorded]);

  return { isRecording, toggleRecording };
}
