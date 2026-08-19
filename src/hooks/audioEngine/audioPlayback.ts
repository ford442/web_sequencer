export type {
  SynthTrack,
  SynthNoteParams,
  DrumNoteParams,
  PlaySynthFn,
  NoteOnSynthFn,
  PlaybackRefs,
} from "./audioPlayback/types";

export { createPlaySynth } from "./audioPlayback/playSynth";
export { createPlayDrum } from "./audioPlayback/playDrum";
export {
  createNoteOnSynth,
  noteOffSynth,
  createStopAllNotes,
  createStopTrackNotes,
} from "./audioPlayback/noteControls";
export { createAmbianceControls } from "./audioPlayback/ambiance";
export {
  setMasterVolume,
  setMasterSaturation,
  setGlobalPan,
  setHarmonizerConfig,
} from "./audioPlayback/masterControls";
export {
  triggerSidechainDuck,
  triggerBassEQDuck,
} from "./audioPlayback/duckingEffects";
