import { describe, it, expect } from 'vitest';
import { formatTick } from './chartTickFormat';

const iso = '2026-05-19T08:30:00Z';

describe('formatTick', () => {
  it('formats half-hour intervals as HH:mm in Europe/Berlin', () => {
    // 08:30 UTC = 10:30 Berlin (CEST)
    expect(formatTick(iso, 1800)).toBe('10:30');
  });

  it('formats six-hour intervals as weekday + HH:mm', () => {
    // 2026-05-19 is a Tuesday
    expect(formatTick(iso, 21600)).toMatch(/Tue 10:30|Di 10:30/);
  });

  it('formats twelve-hour intervals as dd.MM', () => {
    expect(formatTick(iso, 43200)).toBe('19.05');
  });

  it('formats one-day intervals as month short name', () => {
    expect(formatTick(iso, 86400)).toMatch(/May|Mai/);
  });
});
