import { useEffect, useState, type RefObject } from 'react';
import { useWebGPU } from '../WebGPUContext';

/**
 * Hook for setting up WebGPU canvas rendering
 * Handles context configuration and cleanup
 * 
 * @param canvasRef - Reference to the canvas element
 * @returns Canvas context, format, and ready state
 */
export const useWebGPUCanvas = (canvasRef: RefObject<HTMLCanvasElement | null>) => {
    const { device, isInitialized } = useWebGPU();
    const [context, setContext] = useState<GPUCanvasContext | null>(null);
    const [format, setFormat] = useState<GPUTextureFormat | null>(null);
    const [isReady, setIsReady] = useState<boolean>(false);

    useEffect(() => {
        // Wait for WebGPU to be initialized
        if (!isInitialized) return;

        // Check if we have a device and canvas
        if (!device || !canvasRef.current) {
            setIsReady(false);
            return;
        }

        try {
            console.log('useWebGPUCanvas: Configuring canvas context');
            
            // Get WebGPU context from canvas
            const ctx = canvasRef.current.getContext('webgpu') as GPUCanvasContext;
            
            if (!ctx) {
                console.warn('useWebGPUCanvas: Failed to get WebGPU context from canvas');
                setIsReady(false);
                return;
            }

            // Get preferred format
            const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

            // Configure the context
            ctx.configure({
                device,
                format: canvasFormat,
                alphaMode: 'premultiplied',
            });

            setContext(ctx);
            setFormat(canvasFormat);
            setIsReady(true);
            console.log('useWebGPUCanvas: Canvas configured successfully');
        } catch (err) {
            console.error('useWebGPUCanvas: Error configuring canvas:', err);
            setContext(null);
            setFormat(null);
            setIsReady(false);
        }

        // Cleanup function
        return () => {
            if (context) {
                try {
                    context.unconfigure();
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        };
    }, [device, isInitialized, canvasRef]);

    return {
        context,
        format,
        isReady,
    };
};
