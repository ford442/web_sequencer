import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StartOverlay } from '../StartOverlay';
import type { HyphonNativeStatus } from '../../engines/hyphonNativeProbe';
import type { PythonEngineStatus } from '../../pyodide/pythonEngineStore';

vi.mock('../../audio/runtime/AudioRuntime', () => ({ ensureRunning: vi.fn(() => Promise.resolve()) }));

function overlay(over: { native?: HyphonNativeStatus; python?: PythonEngineStatus; reason?: string | null } = {}) {
    const onStart = vi.fn();
    const onLoadPython = vi.fn();
    render(
        <StartOverlay
            onStart={onStart}
            nativeStatus={over.native ?? 'ready'}
            hasWebGpu={false}
            pythonStatus={over.python ?? 'not-requested'}
            pythonReason={over.reason ?? null}
            onLoadPython={onLoadPython}
        />,
    );
    const button = screen.getByTestId('initialize-system');
    // LoadingButton gates with aria-disabled (what Playwright's toBeEnabled reads), not `disabled`.
    return { onStart, onLoadPython, button, blocked: () => button.getAttribute('aria-disabled') === 'true' };
}

describe('StartOverlay gate', () => {
    it('enables once the native module is ready, with Python never requested', () => {
        const { button, onStart, blocked } = overlay({ native: 'ready', python: 'not-requested' });
        expect(blocked()).toBe(false);
        expect(screen.getByTestId('status-python').textContent).toContain('PYTHON TABLE ENGINE:');
        expect(screen.getByTestId('status-python').textContent).toContain('NOT REQUESTED');
        fireEvent.click(button);
        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('stays disabled only while the native probe is pending', () => {
        const { blocked, button, onStart } = overlay({ native: 'pending', python: 'ready' });
        expect(blocked()).toBe(true);
        fireEvent.click(button);
        expect(onStart).not.toHaveBeenCalled();
    });

    it('enables on the JS fallback when the native module could not load', () => {
        const { blocked } = overlay({ native: 'failed' });
        expect(blocked()).toBe(false);
        expect(screen.getByTestId('status-native').textContent).toContain('JS FALLBACK');
    });

    it.each<PythonEngineStatus>(['loading', 'failed', 'ready'])('Python %s does not change the gate', (python) => {
        expect(overlay({ python, reason: 'timed out' }).blocked()).toBe(false);
    });

    it('names the Python line by what it is and shows loaded / failed / not requested', () => {
        const label = (python: PythonEngineStatus) => {
            document.body.innerHTML = '';
            overlay({ python, reason: 'public/pyodide/ missing' });
            return screen.getByTestId('status-python').textContent;
        };
        expect(label('ready')).toContain('LOADED');
        expect(label('failed')).toContain('FAILED');
        expect(label('not-requested')).toContain('NOT REQUESTED');
        expect(label('ready')).not.toContain('PYODIDE');
    });

    it('LOAD asks for the Python engine and is only offered when it was not requested', () => {
        const { onLoadPython } = overlay({ python: 'not-requested' });
        fireEvent.click(screen.getByTestId('load-python-engine'));
        expect(onLoadPython).toHaveBeenCalledTimes(1);

        document.body.innerHTML = '';
        overlay({ python: 'loading' });
        expect(screen.queryByTestId('load-python-engine')).toBeNull();
    });
});
