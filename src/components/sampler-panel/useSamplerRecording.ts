import { useRef, useState, useCallback } from 'react';

export function useSamplerRecording(
  audioContext: AudioContext,
  onRecorded: (buffer: AudioBuffer) => void,
) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const toggleRecording = useCallback(async (setStatus: (s: string) => void) => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      setStatus('Processing...');
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          try {
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            onRecorded(audioBuffer);
            setStatus('Recorded!');
          } catch {
            setStatus('Decode Error');
          }
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
        setStatus('Recording...');
      } catch {
        setStatus('Mic Error');
      }
    }
  }, [isRecording, audioContext, onRecorded]);

  return { isRecording, toggleRecording };
}
