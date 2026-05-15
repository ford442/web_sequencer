import React from 'react';
import type { TrackKey } from '../../constants/appDefaults';
import { LiveKeyboard } from '../LiveKeyboard'

interface KeyboardNodeProps {
  selectedTrack: TrackKey;
  handleKeyboardPlay: (note: string) => void;
  handleKeyboardStop: (note: string) => void;
}

export const KeyboardNode = React.memo(({ selectedTrack, handleKeyboardPlay, handleKeyboardStop }: KeyboardNodeProps) => {
  const activeTrackColor = selectedTrack.startsWith('part')
    ? (selectedTrack === 'partA' ? '#06b6d4' : '#d946ef')
    : selectedTrack === 'bass2' ? '#ff0066' : selectedTrack === 'kick' ? '#f97316' : selectedTrack === 'snare' ? '#22c55e' : selectedTrack === 'sampler' ? '#a855f7' : '#eab308'

  return (
    <div className="w-full bg-[#0d1015] border-2 border-gray-700/50 rounded-xl overflow-hidden shadow-2xl p-2">
      <LiveKeyboard onPlayNote={handleKeyboardPlay} onStopNote={handleKeyboardStop} activeTrackColor={activeTrackColor} />
    </div>
  )
})

export default KeyboardNode
