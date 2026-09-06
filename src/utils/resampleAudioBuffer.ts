/**
 * Convert an AudioBuffer to a target sample rate once (offline render).
 * Live voices must never resample inside process().
 */
export async function resampleAudioBuffer(
    buffer: AudioBuffer,
    targetSampleRate: number,
    signal?: AbortSignal,
): Promise<AudioBuffer> {
    if (buffer.sampleRate === targetSampleRate) return buffer;
    if (signal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
    }
    const offlineCtx = new OfflineAudioContext(
        buffer.numberOfChannels,
        Math.max(1, Math.ceil(buffer.duration * targetSampleRate)),
        targetSampleRate,
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    return offlineCtx.startRendering();
}

/** No-op when buffer already matches the live context; otherwise resample once. */
export async function ensureBufferMatchesContext(
    buffer: AudioBuffer,
    context: BaseAudioContext,
): Promise<AudioBuffer> {
    return resampleAudioBuffer(buffer, context.sampleRate);
}
