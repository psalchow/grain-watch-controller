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

  it('publishes success on an ordinary setSwitch(false)', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setSwitch(true);
    vi.advanceTimersByTime(3500);               // engage + grace, settles on success
    s.setSwitch(false);
    vi.advanceTimersByTime(500);                // contactor releases
    expect(s.getSnapshot().inputState).toBe(false);
    vi.advanceTimersByTime(2500);                // grace elapses
    expect(e.monitors.at(-1)).toEqual({ type: 'success', switchState: false, inputState: false });
  });

  describe('local switching at the contactor (§6)', () => {
    it('engaging by hand while the output is off: warning, then off leaves it held with no alert', () => {
      const e = makeEmit();
      const s = new ShellyMachine(e.emit, OPTS);

      s.manualContactorToggle();                // engaged by hand, output still off
      expect(e.monitors.at(-1)?.type).toBe('warning');
      expect(s.getSnapshot().inputState).toBe(true);

      s.setSwitch(false);                       // backend command, output unchanged (already off)
      vi.advanceTimersByTime(3000);              // would-be grace period
      expect(e.monitors.map((m) => m.type)).not.toContain('alert');
      expect(s.getSnapshot().inputState).toBe(true); // still held by hand, not released by the relay
    });

    it('releasing by hand afterwards publishes success, not warning', () => {
      const e = makeEmit();
      const s = new ShellyMachine(e.emit, OPTS);

      s.manualContactorToggle();                // engaged by hand
      s.setSwitch(false);                       // ignored by the contactor, still held

      s.manualContactorToggle();                // released by hand
      expect(e.monitors.at(-1)?.type).toBe('success');
      expect(s.getSnapshot().inputState).toBe(false);
    });

    it('opening the contactor by hand while the output is on: warning, then off resolves to success', () => {
      const e = makeEmit();
      const s = new ShellyMachine(e.emit, OPTS);

      s.setSwitch(true);
      vi.advanceTimersByTime(3500);              // engage + grace, settles on success

      s.manualContactorToggle();                 // opened by hand while the backend still wants it on
      expect(e.monitors.at(-1)?.type).toBe('warning');
      expect(s.getSnapshot().inputState).toBe(false);

      s.setSwitch(false);                        // backend stands down
      vi.advanceTimersByTime(3000);               // grace elapses
      expect(e.monitors.at(-1)).toEqual({ type: 'success', switchState: false, inputState: false });
    });

    it('a hand switch-off during a backend-on run leaves nothing held, so the next on engages normally', () => {
      // The person released the contactor; they are not holding it. A flag
      // that stayed set here would make the emulator refuse every later
      // command and answer a perfectly ordinary switch-on with a spurious
      // alert and safety_shutoff, with no way back short of a restart.
      const e = makeEmit();
      const s = new ShellyMachine(e.emit, OPTS);

      s.setSwitch(true);
      vi.advanceTimersByTime(3500);              // engage + grace, settles on success

      s.manualContactorToggle();                 // opened by hand
      s.setSwitch(false);                        // backend stands down
      vi.advanceTimersByTime(3000);              // grace elapses on that off

      s.setSwitch(true);                         // a fresh run afterwards
      vi.advanceTimersByTime(500);               // contactor engages again
      expect(s.getSnapshot().inputState).toBe(true);
      vi.advanceTimersByTime(2500);              // grace elapses
      expect(e.monitors.at(-1)).toEqual({ type: 'success', switchState: true, inputState: true });
      const types = e.monitors.map((m) => m.type);
      expect(types).not.toContain('alert');
      expect(types).not.toContain('safety_shutoff');
    });
  });
});
