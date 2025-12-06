import React, { useRef, useState } from 'react';
import type { SamplerParams } from '../types';

interface SamplerPanelProps {
    params: SamplerParams;
    onChange: (updates: Partial<SamplerParams>) => void;
    onLoadSample: (name: string, buffer: AudioBuffer) => void;
    audioContext: AudioContext;
}

export const SamplerPanel: React.FC<SamplerPanelProps> = ({ params, onChange, onLoadSample, audioContext }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const [status, setStatus] = useState<string>('');

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setStatus('Loading...');
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            onLoadSample(params.sampleName, audioBuffer);
            setStatus(`Loaded: ${file.name}`);
        } catch (err) {
            console.error(err);
            setStatus('Error loading file');
        }
    };

    const toggleRecording = async () => {
        if (isRecording) {
            // Stop recording
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
            setStatus('Processing...');
        } else {
            // Start recording
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
                        onLoadSample(params.sampleName, audioBuffer);
                        setStatus('Recorded Sample Loaded');
                    } catch(e) {
                         console.error(e);
                         setStatus('Decode Error');
                    }
                    // Stop all tracks
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                setIsRecording(true);
                setStatus('Recording...');
            } catch (err) {
                console.error("Mic access denied:", err);
                setStatus('Mic Error');
            }
        }
    };

    return (
        <div className="flex flex-col gap-4 p-4 text-xs font-mono text-gray-400">
             <div className="flex items-center gap-4">
                 <div className="flex flex-col gap-1">
                     <label className="text-cyan-500 font-bold">LOAD SAMPLE</label>
                     <input
                        type="file"
                        accept="audio/*"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="hidden"
                     />
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
                            isRecording
                            ? 'bg-red-900 text-red-200 border-red-500 animate-pulse'
                            : 'bg-gray-800 border-gray-600 hover:bg-gray-700'
                        }`}
                     >
                         {isRecording ? 'STOP REC' : 'START REC'}
                     </button>
                 </div>

                 <div className="ml-4 text-white italic">{status}</div>
             </div>

             <div className="flex gap-8 mt-2">
                 <div className="flex flex-col items-center gap-2">
                     <label>VOLUME</label>
                     <input
                        type="range" min="0" max="1" step="0.01"
                        value={params.volume}
                        onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
                        className="w-24 accent-cyan-500 h-1 bg-gray-700 rounded appearance-none"
                     />
                 </div>
                 <div className="flex flex-col items-center gap-2">
                     <label>SPEED</label>
                     <input
                        type="range" min="0.1" max="4.0" step="0.1"
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
