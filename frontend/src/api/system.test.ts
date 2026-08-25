import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { resolveHealthUrl, systemApi } from './system';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const mockAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

describe('resolveHealthUrl', () => {
  it('strips the versioned API segment from an absolute base URL', () => {
    expect(resolveHealthUrl('http://localhost:3000/api/v1')).toBe(
      'http://localhost:3000/health'
    );
  });

  it('handles a trailing slash', () => {
    expect(resolveHealthUrl('https://grainwatch.example.com/api/v1/')).toBe(
      'https://grainwatch.example.com/health'
    );
  });

  it('keeps a relative base URL relative', () => {
    expect(resolveHealthUrl('/api/v1')).toBe('/health');
  });
});

describe('systemApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getHealth returns the health payload', async () => {
    mockAxios.get.mockResolvedValue({
      data: { status: 'healthy', timestamp: '2026-08-25T10:00:00.000Z', version: '1.0.2' },
    });

    const health = await systemApi.getHealth();

    expect(mockAxios.get).toHaveBeenCalledWith(resolveHealthUrl(), { timeout: 5000 });
    expect(health.version).toBe('1.0.2');
  });
});
