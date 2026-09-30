import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FanAutomationPanel } from './FanAutomationPanel';
import { fanApi } from '@/api/fan';
import type { AutomationConfig, AutomationSnapshot } from '@/types/fan';

vi.mock('@/api/fan', () => ({
  fanApi: { getAutomation: vi.fn(), putAutomation: vi.fn() },
}));

const config: AutomationConfig = {
  enabled: false,
  deltaOnK: 10,
  deltaOffK: 2,
  maxOutdoorHumidityPct: 80,
  targetTempC: 12,
  targetHysteresisK: 1,
  minRunMinutes: 30,
  minPauseMinutes: 30,
};

const snapshot = (overrides: Partial<AutomationSnapshot> = {}): AutomationSnapshot => ({
  available: true,
  enabled: false,
  reason: null,
  evaluatedAt: null,
  ...overrides,
});

describe('FanAutomationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fanApi.getAutomation).mockResolvedValue(config);
  });

  it('does not render at all when automation is not available', () => {
    const { container } = render(
      <FanAutomationPanel stockId="grain-watch-1" snapshot={snapshot({ available: false })} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(fanApi.getAutomation).not.toHaveBeenCalled();
  });

  it('loads the configuration and fills the fields', async () => {
    render(<FanAutomationPanel stockId="grain-watch-1" snapshot={snapshot()} />);

    expect(await screen.findByLabelText(/Einschaltschwelle/i)).toHaveValue(10);
    expect(screen.getByLabelText(/Ausschaltschwelle/i)).toHaveValue(2);
    expect(screen.getByLabelText(/Maximale Außenluftfeuchte/i)).toHaveValue(80);
    expect(screen.getByLabelText(/^Zieltemperatur \(/i)).toHaveValue(12);
    expect(screen.getByLabelText(/Hysterese/i)).toHaveValue(1);
    expect(screen.getByLabelText(/Mindestlaufzeit/i)).toHaveValue(30);
    expect(screen.getByLabelText(/Mindestpause/i)).toHaveValue(30);
  });

  it('renders an empty target-temperature field when it is null', async () => {
    vi.mocked(fanApi.getAutomation).mockResolvedValue({ ...config, targetTempC: null });
    render(<FanAutomationPanel stockId="grain-watch-1" snapshot={snapshot()} />);

    expect(await screen.findByLabelText(/^Zieltemperatur \(/i)).toHaveValue(null);
  });

  it('submits enabled with the current parameters when the switch is used', async () => {
    vi.mocked(fanApi.putAutomation).mockResolvedValue({ ...config, enabled: true });
    render(<FanAutomationPanel stockId="grain-watch-1" snapshot={snapshot({ enabled: false })} />);

    await screen.findByLabelText(/Einschaltschwelle/i);
    fireEvent.click(screen.getByRole('button', { name: /Automatik aktivieren/i }));

    await waitFor(() =>
      expect(fanApi.putAutomation).toHaveBeenCalledWith('grain-watch-1', { ...config, enabled: true }),
    );
  });

  it('offers a retry when the configuration cannot be loaded, and unlocks the switch once it arrives', async () => {
    // Without the parameters the single-endpoint PUT cannot be composed, so a
    // failed GET locks the switch in both directions — including re-enabling
    // after a self-disable, the case that endpoint exists to make easy.
    vi.mocked(fanApi.getAutomation).mockRejectedValueOnce(new Error('offline'));
    render(<FanAutomationPanel stockId="grain-watch-1" snapshot={snapshot({ enabled: true })} />);

    expect(await screen.findByText(/konnten nicht geladen werden/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Automatik deaktivieren/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Erneut laden/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Automatik deaktivieren/i })).toBeEnabled(),
    );
    expect(screen.queryByText(/konnten nicht geladen werden/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Einschaltschwelle/i)).toHaveValue(10);
  });

  it('shows the field error from the 400 response instead of a generic failure', async () => {
    vi.mocked(fanApi.putAutomation).mockRejectedValue({
      response: {
        status: 400,
        data: {
          details: { fields: { deltaOnK: ['deltaOnK must be at most 20'] } },
        },
      },
    });
    render(<FanAutomationPanel stockId="grain-watch-1" snapshot={snapshot()} />);

    const deltaOn = await screen.findByLabelText(/Einschaltschwelle/i);
    fireEvent.change(deltaOn, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /Speichern/i }));

    expect(await screen.findByText('deltaOnK must be at most 20')).toBeInTheDocument();
    expect(screen.queryByText(/Automatikeinstellungen konnten nicht gespeichert werden/i)).not.toBeInTheDocument();
  });

  it.each([
    ['no_data', 'Keine verwertbaren Messwerte'],
    ['condensation_risk', 'Kondensationsgefahr am kältesten Messpunkt'],
    ['humidity_high', 'Außenluft zu feucht'],
    ['target_reached', 'Zieltemperatur erreicht'],
    ['delta_too_small', 'Temperaturunterschied zu gering'],
    ['delta_ok', 'Außenluft kühlt'],
    ['min_run_time', 'Mindestlaufzeit läuft noch'],
    ['min_pause', 'Mindestpause läuft noch'],
    ['hold', 'Keine Änderung nötig'],
  ])('renders the German text for reason %s', async (reason, text) => {
    render(
      <FanAutomationPanel
        stockId="grain-watch-1"
        snapshot={snapshot({ enabled: true, reason: reason as AutomationSnapshot['reason'] })}
      />,
    );
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('falls back to the raw string for an unknown reason instead of crashing', async () => {
    render(
      <FanAutomationPanel
        stockId="grain-watch-1"
        snapshot={snapshot({ enabled: true, reason: 'constructor' as AutomationSnapshot['reason'] })}
      />,
    );
    expect(await screen.findByText('constructor')).toBeInTheDocument();
  });

  it('renders the time of the last evaluation', async () => {
    render(
      <FanAutomationPanel
        stockId="grain-watch-1"
        snapshot={snapshot({ evaluatedAt: '2026-09-30T10:00:00.000Z' })}
      />,
    );
    expect(await screen.findByText(/Letzte Auswertung/i)).toBeInTheDocument();
  });

  it('shows a placeholder when the automation has never been evaluated', async () => {
    render(<FanAutomationPanel stockId="grain-watch-1" snapshot={snapshot({ evaluatedAt: null })} />);
    expect(await screen.findByText(/noch nicht ausgewertet/i)).toBeInTheDocument();
  });
});
