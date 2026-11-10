import { translateDeviceMessage } from '@/lib/messages';
import type { FanEvent } from '@/types/fan';

/*
 * German text for the fan audit log. Every lookup is a `Map` rather than a
 * plain object: kinds, sources, reasons and causes all arrive from the wire as
 * unvalidated strings, and a plain object resolves an unknown key such as
 * `constructor` through `Object.prototype` instead of falling through to the
 * `??` fallback — the same trap `FanStatusCard`'s reachability lookup
 * documents.
 */

/** The nine reasons the automation can decide on (design spec §4.3). */
const REASON_LABEL = new Map<string, string>([
  ['no_data', 'Keine verwertbaren Messwerte'],
  ['condensation_risk', 'Kondensationsgefahr am kältesten Messpunkt'],
  ['humidity_high', 'Außenluft zu feucht'],
  ['target_reached', 'Zieltemperatur erreicht'],
  ['delta_too_small', 'Temperaturunterschied zu gering'],
  ['delta_ok', 'Außenluft kühlt'],
  ['min_run_time', 'Mindestlaufzeit läuft noch'],
  ['min_pause', 'Mindestpause läuft noch'],
  ['hold', 'Keine Änderung nötig'],
]);

export function reasonText(reason: string | null): string {
  if (reason === null) return 'Noch keine Entscheidung';
  return REASON_LABEL.get(reason) ?? reason;
}

/** Labels for the event kinds that are not switch commands. */
const KIND_LABEL = new Map<string, string>([
  ['success', 'Quittiert'],
  ['safety_shutoff', 'Sicherheitsabschaltung'],
  ['warning', 'Warnung'],
  ['alert', 'Alarm'],
  ['status', 'Statusmeldung'],
  // Recorded under its original key; the label matches the reachability badge.
  ['online_change', 'Erreichbarkeit geändert'],
  ['watchdog_off', 'Zeitüberschreitung, abgeschaltet'],
  ['stand_down', 'Steuerung entzogen'],
  ['recovery', 'Zustand wiederhergestellt'],
  ['automation_disabled', 'Automatik deaktiviert'],
  ['automation_configured', 'Automatik konfiguriert'],
]);

/** Event kinds that record a problem, highlighted in the history. */
const PROBLEM_KINDS = new Set(['warning', 'alert', 'safety_shutoff', 'watchdog_off']);

const ACTION_LABEL = new Map<string, string>([
  ['on', 'Eingeschaltet'],
  ['off', 'Ausgeschaltet'],
]);

/** Who switched, by the `source` column. `backend` depends on the action. */
const SOURCE_LABEL = new Map<string, string>([
  ['user', 'manuell'],
  ['auto', 'Automatik'],
  // Only the device's own local-switch warning makes the backend send this.
  ['shelly', 'Vor-Ort-Schaltung erkannt'],
]);

/** Why automation switched itself off (`DisableCause`, design spec §5.5). */
const DISABLE_CAUSE_LABEL = new Map<string, string>([
  ['manual_command', 'manuell geschaltet'],
  ['local_switch', 'Vor-Ort-Schaltung'],
  ['fault', 'Störung'],
  ['fan_control_withdrawn', 'Steuerung entzogen'],
]);

export interface FanEventDescription {
  label: string;
  /** Secondary text: the device message, or the readings behind a switch. */
  detail: string | null;
  problem: boolean;
}

type Payload = Record<string, unknown>;

function asPayload(payload: unknown): Payload {
  return payload !== null && typeof payload === 'object' ? (payload as Payload) : {};
}

function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function num(payload: Payload, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The readings an automation switch was decided on, leaving out absent ones. */
function readingsText(payload: Payload): string | null {
  const parts: string[] = [];

  const outdoorTemp = num(payload, 'outdoorTempC');
  const outdoorHumidity = num(payload, 'outdoorHumidityPct');
  const outdoor = [
    outdoorTemp !== null ? `${outdoorTemp.toFixed(1)} °C` : null,
    outdoorHumidity !== null ? `${Math.round(outdoorHumidity)} %` : null,
  ].filter((p) => p !== null);
  if (outdoor.length > 0) parts.push(`Außen ${outdoor.join(', ')}`);

  const dewPoint = num(payload, 'dewPointC');
  if (dewPoint !== null) parts.push(`Taupunkt ${dewPoint.toFixed(1)} °C`);

  const grainMean = num(payload, 'grainMeanC');
  const grainMin = num(payload, 'grainMinC');
  if (grainMean !== null) {
    const min = grainMin !== null ? ` (min ${grainMin.toFixed(1)} °C)` : '';
    parts.push(`Getreide Ø ${grainMean.toFixed(1)} °C${min}`);
  }

  const deltaT = num(payload, 'deltaT');
  if (deltaT !== null) parts.push(`ΔT ${deltaT.toFixed(1)} K`);

  const runMinutes = num(payload, 'runMinutes');
  if (runMinutes !== null) parts.push(`Laufzeit ${formatDuration(runMinutes)}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function originText(source: string, action: string | null, payload: Payload): string {
  if (source === 'backend') return action === 'on' ? 'nach Neustart' : 'Steuerung entzogen';
  const origin = SOURCE_LABEL.get(source) ?? source;
  const reason = source === 'auto' ? str(payload, 'reason') : null;
  return reason !== null ? `${origin}: ${reasonText(reason)}` : origin;
}

function describeSwitch(action: string | null, source: string, payload: Payload): FanEventDescription {
  const actionText = (action !== null ? ACTION_LABEL.get(action) : undefined) ?? 'Schaltbefehl';
  return {
    label: `${actionText} – ${originText(source, action, payload)}`,
    detail: readingsText(payload),
    problem: false,
  };
}

/** Label, secondary text and highlighting for one row of the fan history. */
export function describeFanEvent(event: FanEvent): FanEventDescription {
  const payload = asPayload(event.payload);

  switch (event.kind) {
    case 'command':
      return describeSwitch(str(payload, 'action'), event.source, payload);
    // Written by automation before its reason moved into the command row;
    // still present in older histories.
    case 'auto_on':
      return describeSwitch('on', 'auto', payload);
    case 'auto_off':
      return describeSwitch('off', 'auto', payload);
    case 'automation_disabled': {
      const cause = str(payload, 'cause');
      const causeText = cause !== null ? (DISABLE_CAUSE_LABEL.get(cause) ?? cause) : null;
      return {
        label: causeText !== null ? `Automatik deaktiviert – ${causeText}` : 'Automatik deaktiviert',
        detail: null,
        problem: false,
      };
    }
    default: {
      const message = str(payload, 'message');
      return {
        label: KIND_LABEL.get(event.kind) ?? event.kind,
        detail: message !== null ? translateDeviceMessage(message) : null,
        problem: PROBLEM_KINDS.has(event.kind),
      };
    }
  }
}
