import { describe, it, expect } from 'vitest';
import { toLineProtocol } from './lineprotocol';

describe('toLineProtocol', () => {
  it('formats a Temp point with tags, fields and second precision', () => {
    const line = toLineProtocol([{
      measurement: 'Temp',
      tags: { 'device-group': 'corn-watch-1', device: '1.1' },
      fields: { 'temp-top': 10.5, batteryMV: 436, measurementTimeS: 1000 },
      tsSeconds: 1000,
    }]);
    expect(line).toBe('Temp,device-group=corn-watch-1,device=1.1 temp-top=10.5,batteryMV=436,measurementTimeS=1000 1000');
  });

  it('joins multiple points with newlines', () => {
    const line = toLineProtocol([
      { measurement: 'A', tags: { d: 'x' }, fields: { v: 1 }, tsSeconds: 5 },
      { measurement: 'B', tags: { d: 'y' }, fields: { v: 2 }, tsSeconds: 6 },
    ]);
    expect(line.split('\n')).toHaveLength(2);
  });
});
