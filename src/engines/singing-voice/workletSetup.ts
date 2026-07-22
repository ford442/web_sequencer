import processorUrl from "../../audio-worklets/rubberband-processor.ts?worker&url";
import type { SingingVoiceHost } from "./host";
import { attachWorkletPerf, registerRubberbandNode } from "../../utils/workletPerfBridge";

export const WorkletSetupMixin = {
  /**
   * Initialize the Rubber Band AudioWorklet processor.
   * Must be called before processing audio.
   * AudioWorklet is now the only supported path - ScriptProcessorNode fallback removed.
   * @param _forceScriptProcessor Deprecated parameter - no longer used
   * @param wasmBinary Optional pre-loaded WASM binary to avoid refetching
   */
  async initWorklet(
    this: SingingVoiceHost,
    _forceScriptProcessor: boolean = false,
    wasmBinary?: ArrayBuffer,
  ): Promise<void> {
    // Clean up existing node if reinitializing
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    // AudioWorklet is the only supported path
    if (!this.audioContext.audioWorklet) {
      throw new Error(
        "AudioWorklet is not supported in this browser. SingingVoice requires AudioWorklet.",
      );
    }

    try {
      await this.audioContext.audioWorklet.addModule(processorUrl);

      // Fetch the WASM binary on the main thread to bypass worklet restrictions
      // OR use the pre-loaded one if provided (for multi-voice optimization)
      let binary = wasmBinary;
      if (!binary) {
        const response = await fetch(
          import.meta.env.BASE_URL + "rubberband.wasm",
        );
        if (!response.ok) {
          throw new Error(
            `Failed to fetch rubberband.wasm: ${response.statusText}`,
          );
        }
        binary = await response.arrayBuffer();
      }

      // Create shared buffers for ring buffers
      const inputBuffer = new SharedArrayBuffer(this.config.bufferSize! * 4);
      const outputBuffer = new SharedArrayBuffer(this.config.bufferSize! * 4);

      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "RubberBandProcessor",
      );

      // Initialize the worklet with the fetched binary and buffers (flat structure)
      this.workletNode.port.postMessage({
        type: "INIT_WASM",
        inputBuffer,
        outputBuffer,
        wasmBinary: binary,
        moduleUrl: "/rubberband.js",
        baseUrl: import.meta.env.BASE_URL,
      });

      // Wait for ready signal.
      // IMPORTANT: use port.onmessage (not addEventListener) — setting onmessage
      // automatically calls port.start(), which is required to begin message delivery
      // on a MessagePort. addEventListener alone does NOT start delivery.
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("timeout"));
        }, 5000);
        const handler = (event: MessageEvent) => {
          clearTimeout(timeoutId);
          this.workletNode!.port.onmessage = null;
          if (event.data.type === "READY") {
            resolve();
          } else if (event.data.type === "ERROR") {
            reject(
              new Error(event.data.error || "Worklet initialization failed"),
            );
          }
        };
        this.workletNode!.port.onmessage = handler;
      });

      console.log("SingingVoice: AudioWorklet initialized successfully");
      attachWorkletPerf(this.workletNode, 'rubberband');
      registerRubberbandNode(this.workletNode);
    } catch (e) {
      console.error("SingingVoice: AudioWorklet initialization failed:", e);
      this.workletNode = null;
      throw new Error(
        `AudioWorklet initialization failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  },
};
