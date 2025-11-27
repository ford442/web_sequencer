import { useCallback, useEffect, useState } from 'react';

type WebGpuStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WebGpuState {
    device: GPUDevice | null;
    preferredFormat: GPUTextureFormat | null;
    status: WebGpuStatus;
    error: string | null;
    retry: () => void;
}

let sharedDevice: GPUDevice | null = null;
let sharedFormat: GPUTextureFormat | null = null;
let sharedError: string | null = null;
let sharedPromise: Promise<void> | null = null;

const resetSharedState = () => {
    sharedDevice = null;
    sharedFormat = null;
    sharedError = null;
    sharedPromise = null;
};

const initializeDevice = async () => {
    if (sharedDevice) return;
    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Failed to acquire a GPU adapter.');
    const device = await adapter.requestDevice();
    sharedDevice = device;
    sharedFormat = navigator.gpu.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
};

const ensureSharedDevice = () => {
    if (sharedDevice) return Promise.resolve();
    if (!sharedPromise) {
        sharedPromise = initializeDevice().catch((err) => {
            sharedError = err instanceof Error ? err.message : String(err);
            sharedDevice = null;
            sharedFormat = null;
            sharedPromise = null;
            throw err;
        });
    }
    return sharedPromise;
};

export const acquireSharedWebGpuDevice = async (): Promise<GPUDevice | null> => {
    try {
        await ensureSharedDevice();
        return sharedDevice;
    } catch {
        return null;
    }
};

export const useWebGpuDevice = (): WebGpuState => {
    const [retryToken, setRetryToken] = useState(0);
    const [state, setState] = useState<{
        device: GPUDevice | null;
        preferredFormat: GPUTextureFormat | null;
        status: WebGpuStatus;
        error: string | null;
    }>({
        device: sharedDevice,
        preferredFormat: sharedFormat,
        status: sharedDevice ? 'ready' : (sharedError ? 'error' : 'idle'),
        error: sharedError,
    });

    useEffect(() => {
        let active = true;
        setState((prev) => ({ ...prev, status: 'loading', error: null }));
        ensureSharedDevice().then(() => {
            if (!active) return;
            setState({ device: sharedDevice, preferredFormat: sharedFormat, status: 'ready', error: null });
        }).catch((err) => {
            if (!active) return;
            const message = sharedError ?? (err instanceof Error ? err.message : String(err));
            setState({ device: null, preferredFormat: null, status: 'error', error: message });
        });
        return () => { active = false; };
    }, [retryToken]);

    const retry = useCallback(() => {
        resetSharedState();
        setRetryToken((prev) => prev + 1);
    }, []);

    return { ...state, retry };
};
