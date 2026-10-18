/// <reference types="@webgpu/types" />
/**
 * One way to put a canvas on the shared GPUDevice.
 *
 * Every WebGPU canvas in the app (knobs, scope, curve editor, piano roll)
 * goes through `configureCanvas`, so they agree on three things that used to
 * differ per call site:
 *
 * - **Backing-store size.** `canvas.width/height` track the CSS box ×
 *   `devicePixelRatio`. Changing the size after `configure()` without
 *   reconfiguring leaves the swapchain at the old size, which Chromium
 *   composites 1:1 from the bottom-left (the knob drawn up/right of its hit
 *   box). `syncCanvasSize` resizes *and* reconfigures.
 * - **Alpha.** `premultiplied` by default — every GPU canvas here is drawn
 *   over the panel behind it. A canvas that always clears opaque says so.
 * - **Colour space.** `srgb` unless asked otherwise, so a GPU canvas matches
 *   the CSS/Canvas2D colours around it.
 */

export interface CanvasBufferSize {
    w: number;
    h: number;
}

/** Backing-store size for `canvas`: CSS box × DPR, at least 1×1. */
export function canvasBufferSize(
    canvas: HTMLCanvasElement,
    dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
): CanvasBufferSize {
    const cssW = canvas.clientWidth > 0 ? canvas.clientWidth : canvas.width;
    const cssH = canvas.clientHeight > 0 ? canvas.clientHeight : canvas.height;
    return {
        w: Math.max(1, Math.floor(cssW * dpr)),
        h: Math.max(1, Math.floor(cssH * dpr)),
    };
}

/** `navigator.gpu.getPreferredCanvasFormat()`, or the common default off-browser. */
export function preferredCanvasFormat(): GPUTextureFormat {
    const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
    try {
        return gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    } catch {
        return 'bgra8unorm';
    }
}

export interface CanvasConfig {
    device: GPUDevice;
    alphaMode?: GPUCanvasAlphaMode;
    colorSpace?: PredefinedColorSpace;
    format?: GPUTextureFormat;
    /** An already-acquired context (callers that keep one per slot). */
    context?: GPUCanvasContext | null;
}

export interface ConfiguredCanvas {
    canvas: HTMLCanvasElement;
    context: GPUCanvasContext;
    device: GPUDevice;
    format: GPUTextureFormat;
    alphaMode: GPUCanvasAlphaMode;
    colorSpace: PredefinedColorSpace;
    /** Backing-store size the swapchain was last configured at. */
    width: number;
    height: number;
}

function applyConfiguration(target: ConfiguredCanvas): void {
    target.context.configure({
        device: target.device,
        format: target.format,
        alphaMode: target.alphaMode,
        colorSpace: target.colorSpace,
    });
}

/**
 * Size `canvas` to its CSS box × DPR and configure it on `device`. Returns
 * null when the canvas has no `webgpu` context (already holds a 2D one, or
 * the browser lacks WebGPU).
 */
export function configureCanvas(canvas: HTMLCanvasElement, config: CanvasConfig): ConfiguredCanvas | null {
    const context = config.context ?? (canvas.getContext('webgpu') as GPUCanvasContext | null);
    if (!context) return null;
    const { w, h } = canvasBufferSize(canvas);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const target: ConfiguredCanvas = {
        canvas,
        context,
        device: config.device,
        format: config.format ?? preferredCanvasFormat(),
        alphaMode: config.alphaMode ?? 'premultiplied',
        colorSpace: config.colorSpace ?? 'srgb',
        width: w,
        height: h,
    };
    applyConfiguration(target);
    return target;
}

/**
 * Keep the swapchain in lockstep with the CSS box. Call once per frame before
 * `getCurrentTexture()`; returns true when it resized (and reconfigured).
 */
export function syncCanvasSize(target: ConfiguredCanvas): boolean {
    const { w, h } = canvasBufferSize(target.canvas);
    if (target.canvas.width === w && target.canvas.height === h && target.width === w && target.height === h) {
        return false;
    }
    if (target.canvas.width !== w) target.canvas.width = w;
    if (target.canvas.height !== h) target.canvas.height = h;
    target.width = w;
    target.height = h;
    applyConfiguration(target);
    return true;
}

/** Detach from the device (call when the device is lost or the canvas unmounts). */
export function unconfigureCanvas(target: ConfiguredCanvas | null | undefined): void {
    if (!target) return;
    try {
        target.context.unconfigure?.();
    } catch {
        /* a context from a lost device may already be unusable */
    }
}
