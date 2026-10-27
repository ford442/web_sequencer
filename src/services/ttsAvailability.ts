import { engineDegradationStore } from '../stores/engineDegradationStore';
import { loadingProgressStore } from '../stores/loadingProgressStore';

/**
 * Publish the outcome of `SupertonicService.init()`.
 *
 * Missing ONNX models are a supported state (they are downloaded separately and
 * gitignored): TTS is off, the sampler still plays loaded samples, and the
 * Engine HUD says why. `offReason` is `getUnavailableReason()`.
 */
export function reportTtsAvailability(offReason: string | null): void {
    if (offReason === null) {
        loadingProgressStore.completeStep('ttsEngine');
        engineDegradationStore.resolve('tts');
        return;
    }
    loadingProgressStore.failStep('ttsEngine', new Error(`TTS off: ${offReason}`), true);
    engineDegradationStore.report({
        id: 'tts',
        subsystem: 'tts',
        category: 'audio',
        message: 'TTS off',
        reason: offReason,
        status: 'active',
        activeBackend: 'none',
        requestedBackend: 'supertonic-onnx',
        retryable: false,
    });
}
