import { engineTelemetry } from "../../utils/engineTelemetry";
import { engineDegradationStore } from "../../stores/engineDegradationStore";

/** Telemetry subsystem key; shows as a backend badge under HUD → Subsystems. */
export const VOCAL_FX_SUBSYSTEM = "vocal-fx";
const DEGRADATION_ID = "vocal-fx-native";

export type VocalFxBackendReport = {
  backend: "native" | "ts";
  reason?: string;
};

/** `?vocalFx=ts` pins the TypeScript chain for A/B listening and perf checks. */
export function readVocalFxOverride(search: string | undefined = globalThis.location?.search): "ts" | undefined {
  if (!search) return undefined;
  return new URLSearchParams(search).get("vocalFx") === "ts" ? "ts" : undefined;
}

/**
 * Records which singing-voice FX backend the Rubber Band worklet is running.
 * Native is the default; a TS fallback that was not explicitly requested is a
 * degradation (console + telemetry + degradation store → HUD / banner).
 */
export function recordVocalFxBackend(report: VocalFxBackendReport, forced = false): void {
  try {
    if (report.backend === "native") {
      engineTelemetry.registerResolution(VOCAL_FX_SUBSYSTEM, "native");
      if (engineDegradationStore.getIssue(DEGRADATION_ID)?.status === "active") {
        engineDegradationStore.resolve(DEGRADATION_ID);
      }
      return;
    }

    const reason = report.reason ?? "native FX unavailable";
    if (forced) {
      engineTelemetry.registerResolution(VOCAL_FX_SUBSYSTEM, "ts", reason);
      return;
    }

    console.warn(`[VocalFx] native FX unavailable, running TypeScript chain: ${reason}`);
    engineTelemetry.registerResolution(VOCAL_FX_SUBSYSTEM, "ts-fallback", reason);
    engineTelemetry.recordDegradation(VOCAL_FX_SUBSYSTEM, true, reason);
    engineDegradationStore.report({
      id: DEGRADATION_ID,
      subsystem: VOCAL_FX_SUBSYSTEM,
      category: "worklet",
      message: "Singing voice FX running in TypeScript (higher audio-thread CPU)",
      reason,
      status: "active",
      activeBackend: "ts",
      requestedBackend: "native",
      retryable: false,
    });
  } catch {
    /* telemetry must never break audio */
  }
}
