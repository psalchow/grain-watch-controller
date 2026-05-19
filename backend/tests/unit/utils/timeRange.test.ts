/**
 * Unit tests for the time-range helper used by the history endpoint.
 * All input timestamps are UTC; expected outputs reflect Europe/Berlin
 * boundaries converted back to UTC.
 */

import { getRange } from '../../../src/utils/timeRange';

describe('getRange', () => {
  it('day resolution returns 30-minute buckets starting at local midnight', () => {
    // 2026-05-19T08:30:00Z = 2026-05-19T10:30 Berlin (CEST, UTC+2)
    const now = new Date('2026-05-19T08:30:00Z');
    const range = getRange('day', now);

    expect(range.intervalSeconds).toBe(1800);
    expect(range.toUtc.toISOString()).toBe('2026-05-19T08:30:00.000Z');
    // Local midnight Berlin = 2026-05-19T00:00 +02:00 = 2026-05-18T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-05-18T22:00:00.000Z');
  });

  it('week resolution starts on local Monday 00:00', () => {
    // 2026-05-19T08:30:00Z = Tuesday, 2026-05-19 in Berlin
    const now = new Date('2026-05-19T08:30:00Z');
    const range = getRange('week', now);

    expect(range.intervalSeconds).toBe(21600);
    // Monday 2026-05-18T00:00 +02:00 = 2026-05-17T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-05-17T22:00:00.000Z');
  });

  it('month resolution starts on the local 1st of the month', () => {
    const now = new Date('2026-05-19T08:30:00Z');
    const range = getRange('month', now);

    expect(range.intervalSeconds).toBe(43200);
    // 2026-05-01T00:00 +02:00 = 2026-04-30T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-04-30T22:00:00.000Z');
  });

  it('year resolution starts on local 1 January 00:00', () => {
    const now = new Date('2026-05-19T08:30:00Z');
    const range = getRange('year', now);

    expect(range.intervalSeconds).toBe(86400);
    // 2026-01-01T00:00 +01:00 (CET) = 2025-12-31T23:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2025-12-31T23:00:00.000Z');
  });

  it('handles dates in winter (CET, UTC+1)', () => {
    const now = new Date('2026-02-10T12:00:00Z');
    const range = getRange('day', now);
    // 2026-02-10T00:00 +01:00 = 2026-02-09T23:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-02-09T23:00:00.000Z');
  });

  it('handles the DST transition from CET to CEST (last Sunday of March)', () => {
    // 2026-03-30T08:00Z is the Monday after the spring DST switch (2026-03-29).
    const now = new Date('2026-03-30T08:00:00Z');
    const range = getRange('week', now);
    // Monday 2026-03-30T00:00 +02:00 = 2026-03-29T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('handles the DST transition from CEST to CET (last Sunday of October)', () => {
    // 2026-10-25T05:00:00Z is Sunday 07:00 CEST in Berlin, inside the ISO week
    // that started Mon 2026-10-19 00:00 CEST. The DST fall-back to CET happens
    // later that same Sunday, so the week boundary itself is in CEST.
    const now = new Date('2026-10-25T05:00:00Z');
    const range = getRange('week', now);
    // Mon 2026-10-19 00:00 +02:00 (CEST) = 2026-10-18T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-10-18T22:00:00.000Z');
  });

  it('computes correct local midnight on the fall-back day itself', () => {
    // 2026-10-25T05:00:00Z is 06:00 CET on the fall-back Sunday.
    const now = new Date('2026-10-25T05:00:00Z');
    const range = getRange('day', now);
    // Local midnight 2026-10-25T00:00 +02:00 (CEST, before 03:00 CEST → 02:00 CET transition)
    expect(range.fromUtc.toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  it('treats local Sunday as the last day of the ISO week', () => {
    // 2026-05-24 is a Sunday in Berlin. Week should still start Monday 2026-05-18.
    const now = new Date('2026-05-24T20:00:00Z');
    const range = getRange('week', now);
    expect(range.fromUtc.toISOString()).toBe('2026-05-17T22:00:00.000Z');
  });
});
