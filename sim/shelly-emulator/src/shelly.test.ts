import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShellyMachine, type ShellySnapshot, type MonitorType } from './shelly';

function makeEmit() {
  const monitors: Array<{ type: MonitorType; switchState: boolean; inputState: boolean }> = [];
  const statuses: boolean[] = [];
  const onlines: boolean[] = [];
  let last: ShellySnapshot | null = null;
  const emit = {
    publishMonitor: (type: MonitorType, _m: string, switchState: boolean, inputState: boolean) =>
      { monitors.push({ type, switchState, inputState }); },
    publishStatus: (output: boolean) => { statuses.push(output); },
    publishOnline: (online: boolean) => { onlines.push(online); },
    onChange: (s: ShellySnapshot) => { last = s; },
  };
  return { emit, monitors, statuses, onlines, get last() { return last; } };
}

const OPTS = { gracePeriodMs: 3000, contactorDelayMs: 500, autoOffMs: 60000, now: () => 1000 };

describe('ShellyMachine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes success when the contactor follows (default)', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setSwitch(true);
    expect(e.statuses).toEqual([true]);        // status on switch
    vi.advanceTimersByTime(500);               // contactor engages
    expect(s.getSnapshot().inputState).toBe(true);
    vi.advanceTimersByTime(2500);              // grace elapses
    expect(e.monitors.at(-1)).toEqual({ type: 'success', switchState: true, inputState: true });
  });

  it('publishes alert + safety_shutoff when the contactor will not engage', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setContactorBehaviour('wontEngage');
    s.setSwitch(true);
    vi.advanceTimersByTime(3000);              // grace elapses, input never engaged
    const types = e.monitors.map((m) => m.type);
    expect(types).toContain('alert');
    expect(types).toContain('safety_shutoff');
    expect(s.getSnapshot().switchOutput).toBe(false); // safety shutoff forced output off
  });

  it('publishes a warning on manual contactor toggle without a command', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.manualContactorToggle();
    expect(e.monitors.at(-1)?.type).toBe('warning');
    expect(s.getSnapshot().inputState).toBe(true);
  });

  it('turns the output off on auto-off expiry', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setSwitch(true);
    vi.advanceTimersByTime(500);               // engaged
    vi.advanceTimersByTime(60000);             // auto-off fires
    expect(s.getSnapshot().switchOutput).toBe(false);
    expect(e.statuses.at(-1)).toBe(false);
  });

  it('keep-alive re-assert resets the auto-off timer', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setSwitch(true);
    vi.advanceTimersByTime(40000);             // < autoOff
    s.setSwitch(true);                         // keep-alive re-assert
    vi.advanceTimersByTime(40000);             // 80s total but only 40s since re-assert
    expect(s.getSnapshot().switchOutput).toBe(true);
  });
});
