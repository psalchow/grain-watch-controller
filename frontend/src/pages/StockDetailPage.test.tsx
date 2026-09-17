import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import StockDetailPage from './StockDetailPage';
import { stocksApi } from '@/api';
import { useFanStream } from '@/hooks/useFanStream';
import type { LatestReadingsResponse } from '@/types/api';

vi.mock('@/api', () => ({ stocksApi: { getLatestReadings: vi.fn() } }));
vi.mock('@/hooks/useFanStream', () => ({ useFanStream: vi.fn() }));
vi.mock('@/components/Header', () => ({ Header: () => null }));
vi.mock('@/components/StockHistorySection', () => ({
  StockHistorySection: () => <div data-testid="history" />,
}));

const response = (
  overrides: Partial<LatestReadingsResponse> = {},
): LatestReadingsResponse => ({
  stockId: 'grain-watch-1',
  stockName: 'Halle 8',
  timestamp: '2026-09-17T08:00:00.000Z',
  devices: [
    {
      device: '1.1',
      temperature: { top: 10, mid: 11, bottom: 12 },
      humidity: null,
      batteryMV: null,
      lastMeasurement: '2026-09-17T08:00:00.000Z',
      offline: false,
    },
  ],
  hasGrainSensors: true,
  outdoor: {
    temperature: 14,
    humidity: 70,
    dewPoint: 8.6,
    absoluteHumidity: 8.4,
    lastMeasurement: '2026-09-17T08:00:00.000Z',
    offline: false,
  },
  fanControlEnabled: true,
  ...overrides,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/stocks/grain-watch-1']}>
      <Routes>
        <Route path="/stocks/:stockId" element={<StockDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StockDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useFanStream).mockReturnValue({ snapshot: null, connected: false });
  });

  it('renders a card per current device plus the history', async () => {
    vi.mocked(stocksApi.getLatestReadings).mockResolvedValue(response());
    renderPage();

    expect(await screen.findByText('Sensor 1.1')).toBeInTheDocument();
    expect(screen.getByTestId('history')).toBeInTheDocument();
  });

  it('shows a hint instead of an error when no reading is current', async () => {
    vi.mocked(stocksApi.getLatestReadings).mockResolvedValue(
      response({ devices: [], timestamp: null }),
    );
    renderPage();

    expect(
      await screen.findByText('Keine aktuellen Messwerte vorhanden.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again/i })).not.toBeInTheDocument();
    // Fan control stays reachable while the sensors are silent
    expect(screen.getByRole('button', { name: /Lüfter steuern/i })).toBeInTheDocument();
    // The trend matters most once the sensors have gone quiet
    expect(screen.getByTestId('history')).toBeInTheDocument();
  });

  it('hides cards, hint and history for stocks without grain thermometers', async () => {
    vi.mocked(stocksApi.getLatestReadings).mockResolvedValue(
      response({ devices: [], timestamp: null, hasGrainSensors: false }),
    );
    renderPage();

    expect(await screen.findByRole('button', { name: /Lüfter steuern/i })).toBeInTheDocument();
    expect(screen.queryByText('Keine aktuellen Messwerte vorhanden.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history')).not.toBeInTheDocument();
  });

  it('explains a stock with neither sensors nor fan control', async () => {
    vi.mocked(stocksApi.getLatestReadings).mockResolvedValue(
      response({
        devices: [],
        timestamp: null,
        hasGrainSensors: false,
        fanControlEnabled: false,
      }),
    );
    renderPage();

    expect(
      await screen.findByText(/weder Sensoren noch eine Lüftersteuerung/),
    ).toBeInTheDocument();
  });

  it('still reports a failed request as an error', async () => {
    vi.mocked(stocksApi.getLatestReadings).mockRejectedValue(new Error('boom'));
    renderPage();

    expect(
      await screen.findByText('Sensordaten konnten nicht geladen werden. Bitte erneut versuchen.'),
    ).toBeInTheDocument();
  });
});
