import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudStatus } from '../CloudStatus';

describe('CloudStatus', () => {
    beforeEach(() => {
        vi.mocked(global.fetch).mockReset();
    });

    it('renders with accessibility attributes', async () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => ({}),
        } as Response);

        render(<CloudStatus />);

        await waitFor(() => {
            expect(screen.getAllByText(/CLOUD READY/i).length).toBeGreaterThan(0);
        }, { timeout: 2000 });

        const statusRegion = screen.getByRole('status');
        expect(statusRegion).toBeDefined();
        expect(statusRegion.getAttribute('aria-live')).toBe('polite');
    });
});
