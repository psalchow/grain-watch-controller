import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import FanControlPage from './FanControlPage';
import { fanApi } from '../api/fan';
import { useFanStream } from '../hooks/useFanStream';
import type { FanSnapshot } from '../types/fan';

vi.mock('../api/fan', () => ({ fanApi: { getStatus: vi.fn(), sendCommand: vi.fn() } }));
vi.mock('../hooks/useFanStream', () => ({ useFanStream: vi.fn() }));
vi.mock('../components/Header', () => ({ Header: () => null }));

const snap = (state: string): FanSnapshot => ({
  status: { stockId: 'grain-watch-1', state: state as FanSnapshot['status']['state'], desiredOn: state === 'ON', shellyOnline: true, lastWarning: null, lastAlert: null, since: null, updatedAt: 'x' },
  events: [],
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/stocks/grain-watch-1/fan']}>
      <Routes>
        <Route path="/stocks/:stockId/fan" element={<FanControlPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('FanControlPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fanApi.getStatus).mockResolvedValue(snap('OFF'));
    vi.mocked(fanApi.sendCommand).mockResolvedValue(snap('TURN_ON_PENDING'));
  });

  it('shows an enabled Einschalten button when OFF and sends the command', async () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('OFF'), connected: true });
    renderPage();
    const btn = await screen.findByRole('button', { name: /Einschalten/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(fanApi.sendCommand).toHaveBeenCalledWith('grain-watch-1', 'on'));
  });

  it('disables buttons while pending (in-flight)', () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('TURN_ON_PENDING'), connected: true });
    renderPage();
    expect(screen.getByRole('button', { name: /wird quittiert/i })).toBeDisabled();
  });

  it('shows Ausschalten when running', () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('ON'), connected: true });
    renderPage();
    expect(screen.getByRole('button', { name: /Ausschalten/i })).toBeEnabled();
  });
});
