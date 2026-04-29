import { describe, it, expect } from 'vitest';
import {
  getTemperatureColour,
  calculateAverage,
  formatRelativeTime,
} from './temperature';

describe('getTemperatureColour', () => {
  it('returns green for temperatures below 13°C', () => {
    expect(getTemperatureColour(0)).toBe('#22c55e');
    expect(getTemperatureColour(12.9)).toBe('#22c55e');
  });

  it('returns yellow for temperatures from 13°C to below 22°C', () => {
    expect(getTemperatureColour(13)).toBe('#eab308');
    expect(getTemperatureColour(21.9)).toBe('#eab308');
  });

  it('returns orange for temperatures from 22°C to below 30°C', () => {
    expect(getTemperatureColour(22)).toBe('#f97316');
    expect(getTemperatureColour(29.9)).toBe('#f97316');
  });

  it('returns red for temperatures 30°C and above', () => {
    expect(getTemperatureColour(30)).toBe('#ef4444');
    expect(getTemperatureColour(45)).toBe('#ef4444');
  });

  it('handles negative temperatures as green', () => {
    expect(getTemperatureColour(-5)).toBe('#22c55e');
  });
});

describe('calculateAverage', () => {
  it('averages three layer values', () => {
    expect(calculateAverage(9, 12, 15)).toBe(12);
  });

  it('excludes null values from average', () => {
    expect(calculateAverage(10, null, 20)).toBe(15);
  });

  it('handles single non-null value', () => {
    expect(calculateAverage(null, 18, null)).toBe(18);
  });

  it('returns null when all values are null', () => {
    expect(calculateAverage(null, null, null)).toBeNull();
  });

  it('rounds to one decimal place', () => {
    expect(calculateAverage(10, 11, 12)).toBeCloseTo(11, 1);
    expect(calculateAverage(10.1, 10.2, 10.3)).toBeCloseTo(10.2, 1);
  });
});

describe('formatRelativeTime', () => {
  it('shows "just now" for less than 60 seconds ago', () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe('just now');
  });

  it('shows minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinAgo.toISOString())).toBe('5 min ago');
  });

  it('shows hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoHoursAgo.toISOString())).toBe('2 h ago');
  });

  it('shows days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeDaysAgo.toISOString())).toBe('3 d ago');
  });

  it('returns "unknown" for null input', () => {
    expect(formatRelativeTime(null)).toBe('unknown');
  });
});
