import React, { createContext, useContext, useEffect, useState, useRef } from 'react';

/**
 * WebGPU Context Interface
 * Provides centralized access to WebGPU device and adapter
 */
export interface WebGPUContextValue {
    device: GPUDevice | null;
    adapter: GPUAdapter | null;
    isSupported: boolean;
    isInitialized: boolean;
    error: string | null;
}

const WebGPUContext = createContext<WebGPUContextValue | undefined>(undefined);

/**
 * WebGPU Provider Component
 * Manages singleton GPUAdapter and GPUDevice instance
 * Handles feature detection, browser support, and device loss recovery
 */
export const WebGPUProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [device, setDevice] = useState<GPUDevice | null>(null);
    const [adapter, setAdapter] = useState<GPUAdapter | null>(null);
    const [isSupported, setIsSupported] = useState<boolean>(false);
    const [isInitialized, setIsInitialized] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    
    const initInProgress = useRef(false);

    useEffect(() => {
        // Prevent multiple initialization attempts
        if (initInProgress.current) return;
        initInProgress.current = true;

        const initWebGPU = async () => {
            try {
                // Check if WebGPU is available
                if (!navigator.gpu) {
                    console.log('WebGPUContext: WebGPU API not available in this browser');
                    setIsSupported(false);
                    setIsInitialized(true);
                    return;
                }

                console.log('WebGPUContext: Requesting WebGPU adapter...');
                const requestedAdapter = await navigator.gpu.requestAdapter();
                
                if (!requestedAdapter) {
                    console.log('WebGPUContext: No WebGPU adapter available');
                    setIsSupported(false);
                    setError('No WebGPU adapter available');
                    setIsInitialized(true);
                    return;
                }

                console.log('WebGPUContext: Requesting WebGPU device...');
                const requestedDevice = await requestedAdapter.requestDevice();

                // Handle device loss
                requestedDevice.lost.then((info) => {
                    console.error('WebGPUContext: Device lost:', info.message);
                    setError(`Device lost: ${info.message}`);
                    setDevice(null);
                    
                    // Attempt to recover if the loss was not intentional
                    if (info.reason !== 'destroyed') {
                        console.log('WebGPUContext: Attempting to recover from device loss...');
                        // Reset initialization flag to allow re-initialization
                        initInProgress.current = false;
                        setTimeout(() => {
                            initWebGPU();
                        }, 1000);
                    }
                });

                setAdapter(requestedAdapter);
                setDevice(requestedDevice);
                setIsSupported(true);
                setIsInitialized(true);
                setError(null);
                console.log('WebGPUContext: WebGPU initialized successfully');
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                console.error('WebGPUContext: Failed to initialize WebGPU:', errorMessage);
                setError(errorMessage);
                setIsSupported(false);
                setIsInitialized(true);
            }
        };

        initWebGPU();

        // Cleanup function
        return () => {
            if (device) {
                try {
                    device.destroy();
                } catch (e) {
                    console.warn('WebGPUContext: Error destroying device during cleanup:', e);
                }
            }
        };
    }, []);

    const value: WebGPUContextValue = {
        device,
        adapter,
        isSupported,
        isInitialized,
        error,
    };

    return (
        <WebGPUContext.Provider value={value}>
            {children}
        </WebGPUContext.Provider>
    );
};

/**
 * Hook to access WebGPU context
 * @throws Error if used outside of WebGPUProvider
 */
export const useWebGPU = (): WebGPUContextValue => {
    const context = useContext(WebGPUContext);
    if (context === undefined) {
        throw new Error('useWebGPU must be used within a WebGPUProvider');
    }
    return context;
};
