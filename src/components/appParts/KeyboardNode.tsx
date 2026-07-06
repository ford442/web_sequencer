import React from 'react';
import type { TrackKey } from '../../constants/appDefaults';
import type { DrumSound } from '../../types';
import { LiveKeyboard } from '../LiveKeyboard';
import { DrumPads } from '../DrumPads';

interface KeyboardNodeProps {
  selectedTrack: TrackKey;
  handleKeyboardPlay: (note: string) => void;
  handleKeyboardStop: (note: string) => void;
  handleDrumPadPlay: (sound: DrumSound, velocity?: number) => void;
}

export const KeyboardNode = React.memo(({ selectedTrack, handleKeyboardPlay, handleKeyboardStop, handleDrumPadPlay }: KeyboardNodeProps) => {
  const activeTrackColor = selectedTrack.startsWith('part')
    ? (selectedTrack === 'partA' ? '#06b6d4' : '#d946ef')
    : selectedTrack === 'bass2' ? '#ff0066' : selectedTrack === 'kick' ? '#f97316' : selectedTrack === 'snare' ? '#22c55e' : selectedTrack === 'sampler' ? '#a855f7' : '#eab308'

  return (
    <div className="w-full bg-[#0d1015] border-2 border-gray-700/50 rounded-xl overflow-hidden shadow-2xl p-2">
      <div className="flex flex-col xl:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <LiveKeyboard onPlayNote={handleKeyboardPlay} onStopNote={handleKeyboardStop} activeTrackColor={activeTrackColor} />
        </div>
        <div className="w-full xl:w-80 shrink-0 flex items-center justify-center">
          <DrumPads onPlayDrum={handleDrumPadPlay} />
        </div>
      </div>
    </div>
  )
})

export default KeyboardNode
