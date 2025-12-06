import { useEffect, useState } from 'react';
import { useWebGPU } from '../WebGPUContext';

/**
 * Configuration for creating a compute pipeline
 */
export interface ComputePipelineConfig {
    shaderCode: string;
    entryPoint?: string;
    bindGroupLayoutEntries: GPUBindGroupLayoutEntry[];
}

/**
 * Hook for setting up WebGPU compute pipeline
 * Handles pipeline creation and provides utilities
 * 
 * @param config - Configuration for the compute pipeline
 * @returns Pipeline, bind group layout, and helper to create bind groups
 */
export const useWebGPUCompute = (config: ComputePipelineConfig | null) => {
    const { device, isInitialized } = useWebGPU();
    const [pipeline, setPipeline] = useState<GPUComputePipeline | null>(null);
    const [bindGroupLayout, setBindGroupLayout] = useState<GPUBindGroupLayout | null>(null);

    useEffect(() => {
        // Wait for WebGPU to be initialized
        if (!isInitialized || !device || !config) {
            setPipeline(null);
            setBindGroupLayout(null);
            return;
        }

        try {
            console.log('useWebGPUCompute: Creating compute pipeline');

            // Create shader module
            const shaderModule = device.createShaderModule({
                code: config.shaderCode,
            });

            // Create bind group layout
            const layout = device.createBindGroupLayout({
                entries: config.bindGroupLayoutEntries,
            });

            // Create pipeline layout
            const pipelineLayout = device.createPipelineLayout({
                bindGroupLayouts: [layout],
            });

            // Create compute pipeline
            const computePipeline = device.createComputePipeline({
                layout: pipelineLayout,
                compute: {
                    module: shaderModule,
                    entryPoint: config.entryPoint || 'main',
                },
            });

            setBindGroupLayout(layout);
            setPipeline(computePipeline);
            console.log('useWebGPUCompute: Compute pipeline created successfully');
        } catch (err) {
            console.error('useWebGPUCompute: Error creating compute pipeline:', err);
            setPipeline(null);
            setBindGroupLayout(null);
        }
    }, [device, isInitialized, config]);

    /**
     * Helper function to create a bind group
     * @param entries - Bind group entries
     * @returns Created bind group or null
     */
    const createBindGroup = (entries: GPUBindGroupEntry[]): GPUBindGroup | null => {
        if (!device || !bindGroupLayout) {
            console.warn('useWebGPUCompute: Cannot create bind group - device or layout not ready');
            return null;
        }

        try {
            return device.createBindGroup({
                layout: bindGroupLayout,
                entries,
            });
        } catch (err) {
            console.error('useWebGPUCompute: Error creating bind group:', err);
            return null;
        }
    };

    return {
        pipeline,
        bindGroupLayout,
        createBindGroup,
    };
};
