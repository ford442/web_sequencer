import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudLibrary } from '../CloudLibrary';

// Mock CloudStorage
vi.mock('../../services/CloudStorage', () => ({
    CloudStorage: {
        getSongs: vi.fn().mockResolvedValue([]),
        getSongData: vi.fn(),
        uploadItem: vi.fn()
    },
    CloudStatusManager: {
        notify: vi.fn()
    }
}));

describe('CloudLibrary Accessibility', () => {
    const mockProps = {
        isOpen: true,
        onClose: vi.fn(),
        onLoadData: vi.fn(),
        getSongData: vi.fn(),
        getBankData: vi.fn(),
        getPatternData: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders tabs with correct accessibility attributes', async () => {
        render(<CloudLibrary {...mockProps} />);

        // 1. Check tablist
        const tabList = screen.getByRole('tablist');
        expect(tabList).toHaveAttribute('aria-label', 'Cloud Library Sections');

        // 2. Check tabs
        const browseTab = screen.getByRole('tab', { name: /CLOUD LIBRARY/i });
        const uploadTab = screen.getByRole('tab', { name: /UPLOAD/i });

        expect(browseTab).toHaveAttribute('aria-selected', 'true');
        expect(browseTab).toHaveAttribute('aria-controls', 'cloud-library-panel');
        expect(browseTab).toHaveAttribute('id', 'tab-browse');

        expect(uploadTab).toHaveAttribute('aria-selected', 'false');
        expect(uploadTab).toHaveAttribute('aria-controls', 'cloud-library-panel');
        expect(uploadTab).toHaveAttribute('id', 'tab-upload');

        // 3. Check panel
        const panel = screen.getByRole('tabpanel');
        expect(panel).toHaveAttribute('id', 'cloud-library-panel');
        expect(panel).toHaveAttribute('aria-labelledby', 'tab-browse'); // Initially browse is active
    });

    it('manages focus and selection via keyboard', async () => {
        render(<CloudLibrary {...mockProps} />);

        const tabList = screen.getByRole('tablist');
        const browseTab = screen.getByRole('tab', { name: /CLOUD LIBRARY/i });
        const uploadTab = screen.getByRole('tab', { name: /UPLOAD/i });
        const panel = screen.getByRole('tabpanel');

        // Initial state
        expect(browseTab).toHaveAttribute('aria-selected', 'true');
        expect(panel).toHaveAttribute('aria-labelledby', 'tab-browse');

        // Press ArrowRight on tablist (simulation)
        // Note: In real DOM, focus would be on a tab, but event handler is on container
        fireEvent.keyDown(tabList, { key: 'ArrowRight', code: 'ArrowRight' });

        // Checks
        await waitFor(() => {
            expect(uploadTab).toHaveAttribute('aria-selected', 'true');
            expect(browseTab).toHaveAttribute('aria-selected', 'false');
            expect(panel).toHaveAttribute('aria-labelledby', 'tab-upload');
        });

        // Press ArrowLeft
        fireEvent.keyDown(tabList, { key: 'ArrowLeft', code: 'ArrowLeft' });

        await waitFor(() => {
            expect(browseTab).toHaveAttribute('aria-selected', 'true');
            expect(panel).toHaveAttribute('aria-labelledby', 'tab-browse');
        });
    });
});
