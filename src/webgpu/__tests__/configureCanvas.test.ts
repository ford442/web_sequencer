import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasBufferSize, configureCanvas, syncCanvasSize, unconfigureCanvas } from '../configureCanvas';

function canvasWithBox(cssW: number, cssH: number) {
    const canvas = document.createElement('canvas');
    let w = cssW;
    let h = cssH;
    Object.defineProperty(canvas, 'clientWidth', { get: () => w });
    Object.defineProperty(canvas, 'clientHeight', { get: () => h });
    const context = { configure: vi.fn(), unconfigure: vi.fn(), getCurrentTexture: vi.fn() };
    return {
        canvas,
        context: context as unknown as GPUCanvasContext & typeof context,
        resize: (nw: number, nh: number) => {
            w = nw;
            h = nh;
        },
    };
}

const device = {} as GPUDevice;

describe('configureCanvas', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sizes the backing store to the CSS box × devicePixelRatio', () => {
        vi.stubGlobal('devicePixelRatio', 2);
        const { canvas } = canvasWithBox(100, 40);
        expect(canvasBufferSize(canvas)).toEqual({ w: 200, h: 80 });
        expect(canvasBufferSize(canvas, 1.5)).toEqual({ w: 150, h: 60 });
    });

    it('falls back to the attribute size while the canvas has no layout box', () => {
        const { canvas } = canvasWithBox(0, 0);
        canvas.width = 64;
        canvas.height = 32;
        expect(canvasBufferSize(canvas, 1)).toEqual({ w: 64, h: 32 });
    });

    it('configures premultiplied sRGB by default and honours explicit options', () => {
        vi.stubGlobal('devicePixelRatio', 1);
        const a = canvasWithBox(10, 10);
        const target = configureCanvas(a.canvas, { device, context: a.context, format: 'rgba8unorm' });
        expect(target).not.toBeNull();
        expect(a.context.configure).toHaveBeenCalledWith({
            device,
            format: 'rgba8unorm',
            alphaMode: 'premultiplied',
            colorSpace: 'srgb',
        });

        const b = canvasWithBox(10, 10);
        configureCanvas(b.canvas, { device, context: b.context, format: 'bgra8unorm', alphaMode: 'opaque', colorSpace: 'display-p3' });
        expect(b.context.configure).toHaveBeenCalledWith(expect.objectContaining({ alphaMode: 'opaque', colorSpace: 'display-p3' }));
    });

    it('returns null when the canvas has no webgpu context', () => {
        const canvas = document.createElement('canvas');
        canvas.getContext = vi.fn(() => null) as unknown as typeof canvas.getContext;
        expect(configureCanvas(canvas, { device })).toBeNull();
    });

    it('syncCanvasSize resizes and reconfigures only when the box changed', () => {
        vi.stubGlobal('devicePixelRatio', 1);
        const c = canvasWithBox(50, 20);
        const target = configureCanvas(c.canvas, { device, context: c.context, format: 'bgra8unorm' })!;
        expect(c.context.configure).toHaveBeenCalledTimes(1);

        expect(syncCanvasSize(target)).toBe(false);
        expect(c.context.configure).toHaveBeenCalledTimes(1);

        c.resize(80, 20);
        expect(syncCanvasSize(target)).toBe(true);
        expect(c.canvas.width).toBe(80);
        expect(target.width).toBe(80);
        expect(c.context.configure).toHaveBeenCalledTimes(2);

        unconfigureCanvas(target);
        expect(c.context.unconfigure).toHaveBeenCalled();
    });
});
