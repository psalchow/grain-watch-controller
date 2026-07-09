import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fanApi } from './fan';
import client from './client';

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockClient = client as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

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
});
