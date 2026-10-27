import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A clean checkout has no public/assets/onnx/ (gitignored, fetched by
 * download_models.sh) and the preview server answers with index.html. That
 * must be a clean "TTS off" with a reason in the Engine HUD — not
 * `Unexpected token '<'` and not an ONNX parse of an HTML page.
 */

const create = vi.fn();
vi.mock('../ortRuntime', () => ({
    loadOrt: () => Promise.resolve({ InferenceSession: { create } }),
}));

import { SupertonicService } from '../Supertonic';
import { reportTtsAvailability } from '../ttsAvailability';
import { engineDegradationStore } from '../../stores/engineDegradationStore';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    engineDegradationStore.clear('tts');
});

describe('Supertonic without models', () => {
    it('is TTS off with a stated reason, and never hands HTML to ONNX', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<!doctype html><html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        }))));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const service = SupertonicService.getInstance();
        await service.init();

        expect(service.isServiceReady()).toBe(false);
        expect(service.getUnavailableReason()).toMatch(/assets\/onnx\/tts.json not found .*download_models.sh/);
        expect(create).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(String(info.mock.calls[0]?.[0])).toMatch(/TTS off/);

        reportTtsAvailability(service.getUnavailableReason());
        const issue = engineDegradationStore.getIssue('tts');
        expect(issue?.message).toBe('TTS off');
        expect(issue?.status).toBe('active');
        expect(issue?.reason).toContain('tts.json not found');
    });
});
