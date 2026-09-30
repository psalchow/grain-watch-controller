import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fanApi } from '@/api/fan';
import type { AutomationConfig, AutomationSnapshot } from '@/types/fan';

/**
 * German text for the nine reasons the automation can decide on (design spec
 * §4.3). A `Map` rather than the `Record` lookup `EVENT_LABEL` uses in
 * `FanControlPage`: `reason` arrives from the wire as an unvalidated string,
 * and a plain object resolves an unknown key such as `constructor` through
 * `Object.prototype` instead of falling through to the `??` fallback — the
 * same trap `FanStatusCard`'s reachability lookup documents. A `Map` has no
 * such prototype chain, so `.get` on any string that was never inserted
 * reliably returns `undefined`, and the caller falls back to the raw string
 * rather than rendering something that was never a label.
 */
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

function reasonText(reason: string | null): string {
  if (reason === null) return 'Noch keine Entscheidung';
  return REASON_LABEL.get(reason) ?? reason;
}

function evaluatedAtText(evaluatedAt: string | null): string {
  if (!evaluatedAt) return 'noch nicht ausgewertet';
  return new Date(evaluatedAt).toLocaleString('de-DE');
}

/**
 * The seven parameters, held as the raw text of their input so an
 * in-progress edit — an emptied field, a lone "-" while typing a negative
 * target temperature — is never forced through `Number()` before the user is
 * done. `enabled` is deliberately not part of this draft: the switch always
 * acts on the live `snapshot.enabled`, never on a locally held copy that
 * could drift from what a self-disable just reported over the stream.
 */
type Draft = Record<keyof Omit<AutomationConfig, 'enabled'>, string>;

const FIELDS: Array<{ key: keyof Draft; label: string; step: string }> = [
  { key: 'deltaOnK', label: 'Einschaltschwelle ΔT (K)', step: '0.1' },
  { key: 'deltaOffK', label: 'Ausschaltschwelle ΔT (K)', step: '0.1' },
  { key: 'maxOutdoorHumidityPct', label: 'Maximale Außenluftfeuchte (%)', step: '1' },
  { key: 'targetTempC', label: 'Zieltemperatur (°C, leer = kein Ziel)', step: '0.1' },
  { key: 'targetHysteresisK', label: 'Hysterese der Zieltemperatur (K)', step: '0.1' },
  { key: 'minRunMinutes', label: 'Mindestlaufzeit (Minuten)', step: '1' },
  { key: 'minPauseMinutes', label: 'Mindestpause (Minuten)', step: '1' },
];

function toDraft(config: AutomationConfig): Draft {
  return {
    deltaOnK: String(config.deltaOnK),
    deltaOffK: String(config.deltaOffK),
    maxOutdoorHumidityPct: String(config.maxOutdoorHumidityPct),
    targetTempC: config.targetTempC === null ? '' : String(config.targetTempC),
    targetHysteresisK: String(config.targetHysteresisK),
    minRunMinutes: String(config.minRunMinutes),
    minPauseMinutes: String(config.minPauseMinutes),
  };
}

/**
 * Turns the draft's raw text back into the shape the API expects. Every
 * field but `targetTempC` is forwarded through a bare `Number()` — no bound
 * is re-checked here. §3.1's bounds live in the backend's Zod schema, and a
 * value outside them comes back as a field error in the 400 response, which
 * the form then shows next to the field; duplicating the bounds here would
 * be a second copy of the truth the backend already enforces.
 */
function toPayload(draft: Draft, enabled: boolean): AutomationConfig {
  return {
    enabled,
    deltaOnK: Number(draft.deltaOnK),
    deltaOffK: Number(draft.deltaOffK),
    maxOutdoorHumidityPct: Number(draft.maxOutdoorHumidityPct),
    targetTempC: draft.targetTempC === '' ? null : Number(draft.targetTempC),
    targetHysteresisK: Number(draft.targetHysteresisK),
    minRunMinutes: Number(draft.minRunMinutes),
    minPauseMinutes: Number(draft.minPauseMinutes),
  };
}

/** Pulls the per-field messages out of a 400 response, or `null` for anything else. */
function fieldErrorsFrom(err: unknown): Record<string, string[]> | null {
  if (!err || typeof err !== 'object' || !('response' in err)) return null;
  const response = (
    err as {
      response?: { status?: number; data?: { details?: { fields?: Record<string, string[]> } } };
    }
  ).response;
  if (response?.status !== 400) return null;
  return response.data?.details?.fields ?? null;
}

/**
 * The automation section of the fan page (design spec §8): the switch, the
 * current reason, the time of the last evaluation, and the parameter form.
 * Renders nothing while automation is not available for the stock — the form
 * would have nothing to configure.
 */
export function FanAutomationPanel({
  stockId,
  snapshot,
}: {
  stockId: string;
  snapshot: AutomationSnapshot;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!snapshot.available) return;
    let cancelled = false;
    fanApi
      .getAutomation(stockId)
      .then((config) => {
        if (!cancelled) setDraft(toDraft(config));
      })
      .catch(() => {
        if (!cancelled) setLoadError('Automatikeinstellungen konnten nicht geladen werden.');
      });
    return () => {
      cancelled = true;
    };
  }, [stockId, snapshot.available]);

  if (!snapshot.available) return null;

  const submit = async (payload: AutomationConfig) => {
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      const stored = await fanApi.putAutomation(stockId, payload);
      setDraft(toDraft(stored));
    } catch (err) {
      const fields = fieldErrorsFrom(err);
      if (fields) {
        setFieldErrors(fields);
      } else {
        setSaveError('Automatikeinstellungen konnten nicht gespeichert werden.');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = () => {
    if (!draft) return;
    void submit(toPayload(draft, !snapshot.enabled));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    void submit(toPayload(draft, snapshot.enabled));
  };

  return (
    <section className="mt-8 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Automatik</h2>
        <Button
          type="button"
          size="sm"
          variant={snapshot.enabled ? 'destructive' : 'default'}
          disabled={!draft || saving}
          onClick={toggleEnabled}
        >
          {snapshot.enabled ? 'Automatik deaktivieren' : 'Automatik aktivieren'}
        </Button>
      </div>

      <p className="mt-2 text-sm">
        {snapshot.enabled ? reasonText(snapshot.reason) : 'Automatik ist ausgeschaltet'}
      </p>
      <p className="text-xs text-muted-foreground">
        Letzte Auswertung: {evaluatedAtText(snapshot.evaluatedAt)}
      </p>

      {loadError && <p className="mt-2 text-sm text-destructive">{loadError}</p>}

      {draft && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {FIELDS.map(({ key, label, step }) => (
            <div key={key} className="space-y-1">
              <label htmlFor={`automation-${key}`} className="text-sm font-medium">
                {label}
              </label>
              <Input
                id={`automation-${key}`}
                type="number"
                step={step}
                value={draft[key]}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
                }}
              />
              {fieldErrors[key]?.map((message) => (
                <p key={message} className="text-xs text-destructive">
                  {message}
                </p>
              ))}
            </div>
          ))}

          {saveError && <p className="text-sm text-destructive">{saveError}</p>}

          <Button type="submit" disabled={saving}>
            {saving ? 'Wird gespeichert…' : 'Speichern'}
          </Button>
        </form>
      )}
    </section>
  );
}
