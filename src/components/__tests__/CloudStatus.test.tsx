import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudStatus } from '../CloudStatus';

// Mock fetch
global.fetch = vi.fn();

describe('CloudStatus', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('renders with accessibility attributes', async () => {
        // Mock successful health check to show "CLOUD READY"
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => ({}),
        } as Response);

        render(<CloudStatus />);

        // It should eventually become ONLINE if fetch succeeds
        await waitFor(() => {
            expect(screen.getByText(/CLOUD READY/i)).toBeDefined();
        }, { timeout: 2000 });

        // Check for accessible status role
        const statusRegion = screen.getByRole('status');
        expect(statusRegion).toBeDefined();
        expect(statusRegion.getAttribute('aria-live')).toBe('polite');
    });
});
