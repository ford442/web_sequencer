import type { AudioEngine } from "../../../types";
import type { PlaybackRefs } from "./types";

export function createAmbianceControls(
  context: AudioContext,
  refs: Pick<
    PlaybackRefs,
    | "masterGainRef"
    | "ambianceSourceNodeRef"
    | "ambianceGainNodeRef"
    | "loadedAmbianceBuffersRef"
  >,
): Pick<AudioEngine, "playAmbiance" | "stopAmbiance" | "setAmbianceVolume"> {
  const playAmbiance: AudioEngine["playAmbiance"] = async (url) => {
    if (refs.ambianceSourceNodeRef.current) {
      try {
        refs.ambianceSourceNodeRef.current.stop();
      } catch {
        // Ignore stop() errors from ambiance sources that have already stopped or are otherwise invalid.
      }
    }

    let buffer = refs.loadedAmbianceBuffersRef.current.get(url);
    if (!buffer) {
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      buffer = await context.decodeAudioData(arrayBuffer);
      refs.loadedAmbianceBuffersRef.current.set(url, buffer);
    }

    if (refs.ambianceGainNodeRef.current === null) {
      refs.ambianceGainNodeRef.current = context.createGain();
      refs.ambianceGainNodeRef.current.connect(refs.masterGainRef.current!);
    }

    const src = context.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(refs.ambianceGainNodeRef.current);
    src.start(0);
    refs.ambianceSourceNodeRef.current = src;
  };

  const stopAmbiance = () => {
    const source = refs.ambianceSourceNodeRef.current;
    if (!source) {
      return;
    }
    try {
      source.stop();
    } catch {
      // Ignore stop() errors from ambiance sources that have already stopped or are otherwise invalid.
    }
    refs.ambianceSourceNodeRef.current = null;
  };

  const setAmbianceVolume = (value: number) => {
    if (refs.ambianceGainNodeRef.current) {
      refs.ambianceGainNodeRef.current.gain.value = value;
    }
  };

  return { playAmbiance, stopAmbiance, setAmbianceVolume };
}
