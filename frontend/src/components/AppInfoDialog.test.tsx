import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppInfoDialog } from './AppInfoDialog';
import { systemApi } from '@/api';

vi.mock('@/api', () => ({
  systemApi: { getHealth: vi.fn() },
}));

const mockGetHealth = systemApi.getHealth as unknown as ReturnType<typeof vi.fn>;

const health = (version: string) => ({
  status: 'healthy',
  timestamp: '2026-08-25T10:00:00.000Z',
  version,
});

describe('AppInfoDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing while closed and queries no backend', () => {
    render(<AppInfoDialog open={false} onClose={() => {}} />);

    expect(screen.queryByText('App info')).not.toBeInTheDocument();
    expect(mockGetHealth).not.toHaveBeenCalled();
  });

  it('shows the bundled frontend version and the reported backend version', async () => {
    mockGetHealth.mockResolvedValue(health(__APP_VERSION__));

    render(<AppInfoDialog open onClose={() => {}} />);

    expect(screen.getByText('Frontend')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText(__APP_VERSION__)).toHaveLength(2);
    });
    expect(
      screen.queryByText(/Versionen weichen ab/)
    ).not.toBeInTheDocument();
  });

  it('warns when the backend reports a different version', async () => {
    mockGetHealth.mockResolvedValue(health('9.9.9'));

    render(<AppInfoDialog open onClose={() => {}} />);

    expect(await screen.findByText('9.9.9')).toBeInTheDocument();
    expect(screen.getByText(/Versionen weichen ab/)).toBeInTheDocument();
  });

  it('reports an unavailable backend instead of failing', async () => {
    mockGetHealth.mockRejectedValue(new Error('network down'));

    render(<AppInfoDialog open onClose={() => {}} />);

    expect(await screen.findByText('nicht erreichbar')).toBeInTheDocument();
  });
});
