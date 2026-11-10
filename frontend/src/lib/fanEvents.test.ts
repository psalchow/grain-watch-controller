import { describe, it, expect } from 'vitest';
import { describeFanEvent, reasonText } from './fanEvents';
import type { FanEvent } from '@/types/fan';

function event(kind: string, payload: unknown, source = 'user'): FanEvent {
  return { id: 1, stockId: 's', ts: '2026-11-09T10:00:00.000Z', kind, payload, source };
}

const readings = {
  reason: 'humidity_high',
  grainMeanC: 12.14,
  grainMinC: 10.4,
  outdoorTempC: 8.2,
  outdoorHumidityPct: 91.6,
  dewPointC: 7,
  deltaT: 3.9,
  deltaOnK: 10,
};

describe('describeFanEvent — switch commands', () => {
  it('labels a manual switch by action and origin', () => {
    expect(describeFanEvent(event('command', { action: 'on' }, 'user'))).toEqual({
      label: 'Eingeschaltet – manuell',
      detail: null,
      problem: false,
    });
    expect(describeFanEvent(event('command', { action: 'off' }, 'user')).label).toBe(
      'Ausgeschaltet – manuell',
    );
  });

  it('labels an automation switch with its reason and the readings it decided on', () => {
    const described = describeFanEvent(
      event('command', { action: 'off', ...readings, runMinutes: 107 }, 'auto'),
    );
    expect(described.label).toBe('Ausgeschaltet – Automatik: Außenluft zu feucht');
    expect(described.detail).toBe(
      'Außen 8.2 °C, 92 % · Taupunkt 7.0 °C · Getreide Ø 12.1 °C (min 10.4 °C) · ΔT 3.9 K · Laufzeit 1 h 47 min',
    );
  });

  it('leaves out readings the automation did not have', () => {
    const described = describeFanEvent(
      event(
        'command',
        {
          action: 'off',
          reason: 'no_data',
          grainMeanC: null,
          grainMinC: null,
          outdoorTempC: null,
          outdoorHumidityPct: null,
          dewPointC: null,
          deltaT: null,
          runMinutes: 12,
        },
        'auto',
      ),
    );
    expect(described.label).toBe('Ausgeschaltet – Automatik: Keine verwertbaren Messwerte');
    expect(described.detail).toBe('Laufzeit 12 min');
  });

  it('labels an automation switch recorded before it carried a reason', () => {
    expect(describeFanEvent(event('command', { action: 'on' }, 'auto'))).toEqual({
      label: 'Eingeschaltet – Automatik',
      detail: null,
      problem: false,
    });
  });

  it('labels the switches the backend and the device cause', () => {
    expect(describeFanEvent(event('command', { action: 'on' }, 'backend')).label).toBe(
      'Eingeschaltet – nach Neustart',
    );
    expect(describeFanEvent(event('command', { action: 'off' }, 'backend')).label).toBe(
      'Ausgeschaltet – Steuerung entzogen',
    );
    expect(describeFanEvent(event('command', { action: 'off' }, 'shelly')).label).toBe(
      'Ausgeschaltet – Vor-Ort-Schaltung erkannt',
    );
  });

  it('falls back to the raw values for an unknown action or origin', () => {
    expect(describeFanEvent(event('command', { action: 'toggle' }, 'user')).label).toBe(
      'Schaltbefehl – manuell',
    );
    expect(describeFanEvent(event('command', { action: 'on' }, 'constructor')).label).toBe(
      'Eingeschaltet – constructor',
    );
    expect(describeFanEvent(event('command', null, 'user')).label).toBe('Schaltbefehl – manuell');
  });
});

describe('describeFanEvent — older automation rows', () => {
  it('renders auto_on and auto_off like an automation switch', () => {
    expect(describeFanEvent(event('auto_on', { ...readings, reason: 'delta_ok' }, 'auto')).label).toBe(
      'Eingeschaltet – Automatik: Außenluft kühlt',
    );
    const off = describeFanEvent(event('auto_off', { ...readings, runMinutes: 30 }, 'auto'));
    expect(off.label).toBe('Ausgeschaltet – Automatik: Außenluft zu feucht');
    expect(off.detail).toContain('Laufzeit 30 min');
  });
});

describe('describeFanEvent — other kinds', () => {
  it('names the cause when automation disabled itself', () => {
    expect(
      describeFanEvent(event('automation_disabled', { cause: 'manual_command' }, 'auto')).label,
    ).toBe('Automatik deaktiviert – manuell geschaltet');
    expect(describeFanEvent(event('automation_disabled', { cause: 'fault' }, 'auto')).label).toBe(
      'Automatik deaktiviert – Störung',
    );
    expect(describeFanEvent(event('automation_disabled', null, 'auto')).label).toBe(
      'Automatik deaktiviert',
    );
  });

  it('translates the device message and flags problems', () => {
    expect(
      describeFanEvent(
        event('warning', { message: 'Input changed without switch command' }, 'shelly'),
      ),
    ).toEqual({
      label: 'Warnung',
      detail: 'Schütz wurde von Hand geschaltet (ohne Befehl der Steuerung)',
      problem: true,
    });
  });

  it('passes an unknown kind through', () => {
    expect(describeFanEvent(event('toString', null)).label).toBe('toString');
  });
});

describe('reasonText', () => {
  it('translates a known reason and passes an unknown one through', () => {
    expect(reasonText('min_pause')).toBe('Mindestpause läuft noch');
    expect(reasonText('constructor')).toBe('constructor');
    expect(reasonText(null)).toBe('Noch keine Entscheidung');
  });
});
