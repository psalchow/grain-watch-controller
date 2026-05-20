import { describe, it, expect } from 'vitest';
import { getDeviceColour } from './deviceColours';

describe('getDeviceColour', () => {
  it.each([
    ['1.1', '#2563eb'],
    ['1.2', '#16a34a'],
    ['1.3', '#d97706'],
    ['1.4', '#9333ea'],
    ['1.5', '#db2777'],
  ])('returns the dedicated colour for device %s', (device, colour) => {
    expect(getDeviceColour(device)).toBe(colour);
  });

  it('returns a deterministic palette colour for unknown devices', () => {
    const c1 = getDeviceColour('9.9');
    const c2 = getDeviceColour('9.9');
    expect(c1).toBe(c2);
    expect(['#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777']).toContain(c1);
  });
});
