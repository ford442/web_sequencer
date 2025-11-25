import React, { useRef, useState } from 'react';
import type { SamplerParams } from '../types';

interface SamplerPanelProps {
  params: SamplerParams;
  onChange: (updates: Partial<SamplerParams>) => void;
  onLoadSample: (name: string, buffer: AudioBuffer) => void;
  onTuneSample: () => Promise<void>;
  audioContext?: AudioContext;
  initializeAudio: () => Promise<any>;
}

export const SamplerPanel: React.FC<SamplerPanelProps> = ({ params, onChange, onLoadSample, onTuneSample, audioContext, initializeAudio }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [status, setStatus] = useState<string>('');
  const [isSampleLoaded, setIsSampleLoaded] = useState(false);
  const [tuneStatus, setTuneStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const loadAudioBuffer = async (buffer: AudioBuffer) => {
    onLoadSample(params.sampleName, buffer);
    setIsSampleLoaded(true);
    setStatus('Sample Loaded.');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('Loading...');
    try {
      let ctx = audioContext;
      if (!ctx) {
        const newEngine = await initializeAudio();
        ctx = newEngine.context;
      }

      if (!ctx) {
        console.warn('AudioContext is not available. Aborting sample load.');
        setStatus('No AudioContext');
        return;
      }

      const safeCtx = ctx; // capture non-null context for subsequent awaits
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await safeCtx.decodeAudioData(arrayBuffer);
      loadAudioBuffer(audioBuffer);
    } catch (err) {
      console.error(err);
      setStatus('Error loading file');
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      setStatus('Processing...');
      return;
    }

    try {
      let ctx = audioContext;
      if (!ctx) {
        const newEngine = await initializeAudio();
        ctx = newEngine.context;
      }

      if (!ctx) {
        console.warn('AudioContext is not available. Aborting recording.');
        setStatus('No AudioContext');
        return;
      }

      const safeCtx = ctx; // capture non-null context for callbacks
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        try {
          const audioBuffer = await safeCtx.decodeAudioData(arrayBuffer);
          loadAudioBuffer(audioBuffer);
        } catch (e) {
          console.error(e);
          setStatus('Decode Error');
        }
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatus('Recording...');
    } catch (err) {
      console.error('Mic access denied:', err);
      setStatus('Mic Error');
    }
  };

  const handleAutoTune = async () => {
    setStatus('Tuning...');
    setTuneStatus('idle');
    try {
      await onTuneSample();
      setStatus('Auto-Tune Complete!');
      setTuneStatus('success');
    } catch (error) {
      setStatus('Auto-Tune Failed.');
      setTuneStatus('error');
      setTimeout(() => setTuneStatus('idle'), 1000);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs font-mono text-gray-400">
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-cyan-500 font-bold">LOAD SAMPLE</label>
          <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 active:bg-gray-600 transition-colors"
          >
            CHOOSE FILE
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-red-500 font-bold">RECORD MIC</label>
          <button
            onClick={toggleRecording}
            className={`px-3 py-2 border rounded transition-all ${
              isRecording ? 'bg-red-900 text-red-200 border-red-500 animate-pulse' : 'bg-gray-800 border-gray-600 hover:bg-gray-700'
            }`}
          >
            {isRecording ? 'STOP REC' : 'START REC'}
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className={`font-bold ${!isSampleLoaded ? 'text-gray-600' : 'text-green-500'}`}>AUTO-TUNE</label>
          <button
            onClick={handleAutoTune}
            disabled={!isSampleLoaded}
            className={`px-3 py-2 border rounded transition-all ${
              !isSampleLoaded
                ? 'bg-gray-900 border-gray-700 text-gray-600 cursor-not-allowed'
                : tuneStatus === 'error'
                ? 'bg-red-900 text-red-200 border-red-500'
                : tuneStatus === 'success'
                ? 'bg-green-900 text-green-200 border-green-500'
                : 'bg-gray-800 border-gray-600 hover:bg-gray-700'
            }`}
          >
            TUNE TO C4
          </button>
        </div>

        <div className="ml-4 text-white italic self-end pb-1">{status}</div>
      </div>

      <div className="flex gap-8 mt-2">
        <div className="flex flex-col items-center gap-2">
          <label>VOLUME</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={params.volume}
            onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
            className="w-24 accent-cyan-500 h-1 bg-gray-700 rounded appearance-none"
          />
        </div>

        <div className="flex flex-col items-center gap-2">
          <label>SPEED</label>
          <input
            type="range"
            min="0.1"
            max="4.0"
            step="0.1"
            value={params.playbackSpeed}
            onChange={(e) => onChange({ playbackSpeed: parseFloat(e.target.value) })}
            className="w-24 accent-purple-500 h-1 bg-gray-700 rounded appearance-none"
          />
          <span>{params.playbackSpeed.toFixed(1)}x</span>
        </div>
      </div>
    </div>
  );
};
