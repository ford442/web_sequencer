import React from 'react';
import { useAppStateSlice } from '../../contexts/AppStateContext';
import { LiveKeyboard } from '../LiveKeyboard';
import { DrumPads } from '../DrumPads';

const KEYBOARD_KEYS = ['selectedTrack', 'handleKeyboardPlay', 'handleKeyboardStop', 'handleDrumPadPlay'] as const;

export const KeyboardNode = React.memo(() => {
  const { selectedTrack, handleKeyboardPlay, handleKeyboardStop, handleDrumPadPlay } = useAppStateSlice(KEYBOARD_KEYS);

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
