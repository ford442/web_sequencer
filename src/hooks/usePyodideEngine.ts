import { useState, useEffect, useRef } from 'react';

// Wrapper interface for the worker
export interface PyodideWorkerApi {
    isReady: boolean;
    generateWave: (params: any) => Promise<Float32Array>;
    generateDrum: (type: 'kick' | 'snare' | 'hat', params: any) => Promise<Float32Array>;
    generateSampler: (params: any) => Promise<Float32Array>;
    loadSample: (name: string, data: Float32Array) => void;
}

export const usePyodideEngine = () => {
    const [isPyodideReady, setIsPyodideReady] = useState(false);
    const [status, setStatus] = useState('Initializing Worker...');
    const workerRef = useRef<Worker | null>(null);
    const pendingRequests = useRef<Map<number, (data: Float32Array) => void>>(new Map());
    const requestIdCounter = useRef(0);

    useEffect(() => {
        if (workerRef.current) return;

        const worker = new Worker(new URL('../workers/pyodide.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        worker.onmessage = (e) => {
            const { type, id, data, error } = e.data;

            if (type === 'ready') {
                setIsPyodideReady(true);
                setStatus('Python Engine Ready!');
                setTimeout(() => setStatus(''), 2000);
            } else if (id !== undefined) {
                const resolve = pendingRequests.current.get(id);
                if (resolve) {
                    if (error) {
                        console.error("Worker returned error:", error);
                        // Resolve with empty buffer to prevent crash
                        resolve(new Float32Array(0));
                    } else {
                        resolve(data);
                    }
                    pendingRequests.current.delete(id);
                }
            }
        };

        worker.postMessage({ type: 'init' });

        return () => {
            worker.terminate();
        };
    }, []);

    const sendRequest = (type: string, params: any): Promise<Float32Array> => {
        return new Promise((resolve) => {
            if (!workerRef.current || !isPyodideReady) {
                resolve(new Float32Array(0));
                return;
            }
            const id = requestIdCounter.current++;
            pendingRequests.current.set(id, resolve);
            workerRef.current.postMessage({ type, id, params });
        });
    };

    const api: PyodideWorkerApi = {
        isReady: isPyodideReady,
        generateWave: (params) => sendRequest('generate_wave', params),
        generateDrum: (type, params) => {
            if (type === 'kick') return sendRequest('generate_kick', params);
            if (type === 'snare') return sendRequest('generate_snare', params);
            return sendRequest('generate_hat', params);
        },
        generateSampler: (params) => sendRequest('generate_sampler', params),
        loadSample: (name, data) => {
            workerRef.current?.postMessage({ type: 'load_sample', params: { name, data } });
        }
    };

    return { pyodideWorker: api, isPyodideReady, pyodideStatus: status };
};
