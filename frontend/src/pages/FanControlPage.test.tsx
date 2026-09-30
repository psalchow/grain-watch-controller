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

const snap = (
  state: string,
  overrides: Partial<FanSnapshot['status']> = {},
): FanSnapshot => ({
  status: {
    stockId: 'grain-watch-1',
    state: state as FanSnapshot['status']['state'],
    desiredOn: state === 'ON',
    fanControlReachable: true,
    contactorEngaged: null,
    lastWarning: null,
    lastAlert: null,
    since: null,
    updatedAt: 'x',
    ...overrides,
  },
  events: [],
  automation: { available: false, enabled: false, reason: null, evaluatedAt: null },
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
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('OFF'), connected: true, disabled: false });
    renderPage();
    const btn = await screen.findByRole('button', { name: /Einschalten/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(fanApi.sendCommand).toHaveBeenCalledWith('grain-watch-1', 'on'));
  });

  it('disables buttons while pending (in-flight)', () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('TURN_ON_PENDING'), connected: true, disabled: false });
    renderPage();
    expect(screen.getByRole('button', { name: /wird quittiert/i })).toBeDisabled();
  });

  it('replaces the controls when the stream reports fan control as withdrawn', () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('ON'), connected: false, disabled: true });
    renderPage();
    expect(screen.getByText(/keine Lüftersteuerung zur Verfügung/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ausschalten/i })).not.toBeInTheDocument();
  });

  it('shows the notice when the status load answers 404', async () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: null, connected: false, disabled: false });
    vi.mocked(fanApi.getStatus).mockRejectedValue({ response: { status: 404 } });
    renderPage();

    expect(await screen.findByText(/keine Lüftersteuerung zur Verfügung/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Einschalten/i })).not.toBeInTheDocument();
  });

  it('shows Ausschalten when running', () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('ON'), connected: true, disabled: false });
    renderPage();
    expect(screen.getByRole('button', { name: /Ausschalten/i })).toBeEnabled();
  });

  it('shows Erneut einschalten on FAULT', () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('FAULT'), connected: true, disabled: false });
    renderPage();
    expect(screen.getByRole('button', { name: /Erneut einschalten/i })).toBeEnabled();
  });

  it('offers no switch-off button for a fan running on a locally held contactor', () => {
    // The backend reports the terminal state the device told it about (design
    // spec §5.6), so `state` alone would offer "Ausschalten" for a run it has
    // no authority to stop (§6).
    vi.mocked(useFanStream).mockReturnValue({
      snapshot: snap('ON', { desiredOn: false, contactorEngaged: true }),
      connected: true,
      disabled: false,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: /Ausschalten/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Einschalten/i })).not.toBeInTheDocument();
  });

  it('offers no button on FAULT while the contactor is held locally', () => {
    // A reachable combination — a fault while somebody holds the contactor at
    // the panel — and the branch order that resolves it is a spec decision
    // (§8): the local run is tested before FAULT, because the backend has no
    // authority over a contactor held by hand (§6). Swapping the two would
    // silently offer a button again.
    vi.mocked(useFanStream).mockReturnValue({
      snapshot: snap('FAULT', { desiredOn: false, contactorEngaged: true }),
      connected: true,
      disabled: false,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: /Erneut einschalten/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ausschalten/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Einschalten$/ })).not.toBeInTheDocument();
  });
});
