/**
 * Python is on demand: the boot graph reaches `bootstrap.ts` (the Pyodide
 * loader plus the Python source) only through the dynamic import in
 * pythonEngineStore. A static import anywhere else would put `pyodide.js`
 * back on the first paint.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bootstrapLoaded = vi.hoisted(() => vi.fn());
vi.mock('../bootstrap', () => {
    bootstrapLoaded();
    return { initPyodideSystem: vi.fn(() => Promise.resolve()) };
});
vi.mock('../../contexts/AppStateContext', () => ({
    useAppStateSlice: () => ({ hasStarted: false, handleStart: vi.fn() }),
}));
vi.mock('../../audio/runtime/AudioRuntime', () => ({ ensureRunning: vi.fn(() => Promise.resolve()) }));

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(full);
        return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
    });
}

describe('Python table engine stays off the boot graph', () => {
    it('only pythonEngineStore reaches pyodide/bootstrap, and only through import()', () => {
        const reaches = /['"](?:\.\.?\/)+(?:pyodide\/)?bootstrap['"]|['"][^'"]*pyodide\/bootstrap['"]/;
        const offenders: string[] = [];
        for (const file of walk(srcDir)) {
            const rel = path.relative(srcDir, file).split(path.sep).join('/');
            if (rel === 'pyodide/bootstrap.ts') continue;
            const text = fs.readFileSync(file, 'utf8');
            const staticImport = /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"][^'"]*\bbootstrap['"]/m.test(text) && reaches.test(text);
            const dynamicImport = /import\(\s*['"][^'"]*\bbootstrap['"]\s*\)/.test(text);
            if (staticImport) offenders.push(`${rel}: static import`);
            if (dynamicImport && rel !== 'pyodide/pythonEngineStore.ts') offenders.push(`${rel}: dynamic import outside the store`);
        }
        expect(offenders).toEqual([]);
        const store = fs.readFileSync(path.join(srcDir, 'pyodide/pythonEngineStore.ts'), 'utf8');
        expect(store).toMatch(/import\('\.\/bootstrap'\)/);
    });

    it('the start overlay\'s first paint does not load the bootstrap or add a pyodide.js script', async () => {
        const { StartOverlayNode } = await import('../../components/appParts/AppOverlays');
        const before = document.querySelectorAll('script[src*="pyodide"]').length;

        const { getByTestId } = render(<StartOverlayNode />);
        await new Promise((r) => setTimeout(r, 0));

        expect(getByTestId('status-python').textContent).toContain('NOT REQUESTED');
        expect(bootstrapLoaded).not.toHaveBeenCalled();
        expect(document.querySelectorAll('script[src*="pyodide"]').length).toBe(before);
    });
});
