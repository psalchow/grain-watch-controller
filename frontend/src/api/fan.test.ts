import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fanApi } from './fan';
import client from './client';

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const mockClient = client as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

describe('fanApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getStatus calls the fan endpoint', async () => {
    mockClient.get.mockResolvedValue({ data: { status: { state: 'OFF' }, events: [] } });
    const snap = await fanApi.getStatus('grain-watch-1');
    expect(mockClient.get).toHaveBeenCalledWith('/stocks/grain-watch-1/fan');
    expect(snap.status.state).toBe('OFF');
  });

  it('sendCommand posts the action', async () => {
    mockClient.post.mockResolvedValue({ data: { status: { state: 'TURN_ON_PENDING' }, events: [] } });
    const snap = await fanApi.sendCommand('grain-watch-1', 'on');
    expect(mockClient.post).toHaveBeenCalledWith('/stocks/grain-watch-1/fan/command', { action: 'on' });
    expect(snap.status.state).toBe('TURN_ON_PENDING');
  });

  it('getAutomation calls the automation endpoint', async () => {
    mockClient.get.mockResolvedValue({ data: { enabled: true } });
    const config = await fanApi.getAutomation('grain-watch-1');
    expect(mockClient.get).toHaveBeenCalledWith('/stocks/grain-watch-1/fan/automation');
    expect(config.enabled).toBe(true);
  });

  it('putAutomation puts the config', async () => {
    const config = {
      enabled: true,
      deltaOnK: 10,
      deltaOffK: 2,
      maxOutdoorHumidityPct: 80,
      targetTempC: 12,
      targetHysteresisK: 1,
      minRunMinutes: 30,
      minPauseMinutes: 30,
    };
    mockClient.put.mockResolvedValue({ data: config });
    const stored = await fanApi.putAutomation('grain-watch-1', config);
    expect(mockClient.put).toHaveBeenCalledWith('/stocks/grain-watch-1/fan/automation', config);
    expect(stored).toEqual(config);
  });
});
