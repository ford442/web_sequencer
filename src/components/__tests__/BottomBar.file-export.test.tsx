import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomBar } from '../BottomBar';

describe('BottomBar file export loading states', () => {
    it('shows loading state correctly when exporting RBS', () => {
        const props = {
            viewMode: 'notes' as const,
            setViewMode: vi.fn(),
            automationParam: 'foo',
            setAutomationParam: vi.fn(),
            isLyricTrackVisible: false,
            setIsLyricTrackVisible: vi.fn(),
            isImportingAISong: false,
            aiImportStage: null,
            aiImportProgress: 0,
            exportSongToFile: vi.fn(),
            exportRbsToFile: vi.fn(),
            exportSmfToFile: vi.fn(),
            importSongFromFile: vi.fn(),
            isExportingRbs: true,
            isExportingSmf: false,
            setIsRbsImportModalOpen: vi.fn(),
            setIsSmfImportModalOpen: vi.fn(),
            setIsExportModalOpen: vi.fn(),
            setIsAISongModalOpen: vi.fn(),
            setIsCloudLibraryOpen: vi.fn(),
            handleAutoMix: vi.fn(),
            reverbType: 'room' as const,
            handleReverbType: vi.fn(),
            masterSaturation: 0,
            handleMasterSaturation: vi.fn(),
            handleMasterSaturationKeyDown: vi.fn(),
            handleMasterSaturationReset: vi.fn(),
            masterVolume: 1,
            handleMasterVolume: vi.fn(),
            handleMasterVolumeKeyDown: vi.fn(),
            handleMasterVolumeReset: vi.fn(),
            globalPan: 0,
            handleGlobalPan: vi.fn(),
            handleGlobalPanKeyDown: vi.fn(),
            handleGlobalPanReset: vi.fn(),
            audioEngine: {},
            forceScriptProcessorFallback: false,
            setForceScriptProcessorFallback: vi.fn(),
            showToast: vi.fn(),
            setShowGamepadDebug: vi.fn(),
            setIsShortcutsHelpOpen: vi.fn(),
        };

        render(<BottomBar {...props} />);

        const rbsButton = screen.getByRole('button', { name: 'Export project as ReBirth RB-338 .rbs file' });
        expect(rbsButton).toHaveAttribute('aria-disabled', 'true');
        expect(rbsButton).toHaveAttribute('aria-busy', 'true');
        expect(rbsButton).toHaveTextContent('Exporting...');
    });
});
