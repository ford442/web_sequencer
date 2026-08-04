import type { MutableRefObject } from "react";
import { Harmonizer, type HarmonizerConfig } from "../../../engines/Harmonizer";
import { makeDistortionCurve } from "../distortion";

export function setMasterVolume(
  masterGainRef: MutableRefObject<GainNode | null>,
  value: number,
): void {
  if (masterGainRef.current) {
    masterGainRef.current.gain.value = value;
  }
}

export function setMasterSaturation(
  masterSaturationRef: MutableRefObject<WaveShaperNode | null>,
  amount: number,
): void {
  if (masterSaturationRef.current) {
    masterSaturationRef.current.curve = makeDistortionCurve(amount * 100);
  }
}

export function setGlobalPan(
  masterPannerRef: MutableRefObject<StereoPannerNode | null>,
  value: number,
): void {
  if (masterPannerRef.current) {
    masterPannerRef.current.pan.value = value;
  }
}

export function setHarmonizerConfig(
  harmonizerRef: MutableRefObject<Harmonizer | null>,
  config: HarmonizerConfig,
  isActive: boolean,
): void {
  if (!harmonizerRef.current) {
    return;
  }

  harmonizerRef.current.setConfig(config);
  harmonizerRef.current.setActive(isActive);
  console.log(
    "[useAudioEngine] Harmonizer config updated:",
    config,
    "active:",
    isActive,
  );
}
