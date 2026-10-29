import { useState, type ReactNode, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { extractError } from '@/lib/messages';
import type { AdminStock, CreateStockRequest } from '@/types/api';

export interface StockFormDialogProps {
  open: boolean;
  /** Absent means create; present means edit that stock. */
  stock?: AdminStock;
  /**
   * The fan topic prefixes of the *other* stocks. A prefix addresses one fan
   * controller, so reusing one would switch a neighbour's fan; the backend
   * refuses it with 409 and this pre-empts it in German.
   */
  takenTopicPrefixes?: string[];
  /** Rejects to keep the dialog open and show the failure beside the fields. */
  onSave: (values: CreateStockRequest) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * The ten configuration fields of a stock, held as the raw text of their
 * inputs so an in-progress edit is never forced through `Number()` or trimmed
 * before the operator is done — the same approach `FanAutomationPanel` takes.
 */
interface Draft {
  name: string;
  description: string;
  active: boolean;
  deviceGroup: string;
  hasGrainSensors: boolean;
  hasHumidity: boolean;
  outdoorDevice: string;
  fanControlEnabled: boolean;
  fanTopicPrefix: string;
  fanSwitchId: string;
}

/**
 * A new stock starts where the backend's own defaults are
 * (`createStockSchema`): equipped with grain thermometers, active, no fan.
 */
function toDraft(stock?: AdminStock): Draft {
  return {
    name: stock?.name ?? '',
    description: stock?.description ?? '',
    active: stock?.active ?? true,
    deviceGroup: stock?.deviceGroup ?? '',
    hasGrainSensors: stock?.hasGrainSensors ?? true,
    hasHumidity: stock?.hasHumidity ?? false,
    outdoorDevice: stock?.outdoorDevice ?? '',
    fanControlEnabled: stock?.fanControlEnabled ?? false,
    fanTopicPrefix: stock?.fanTopicPrefix ?? '',
    fanSwitchId: String(stock?.fanSwitchId ?? 0),
  };
}

/** An emptied nullable field clears it; `''` would be stored as text. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Mirrors `createStockSchema` so the operator reads German.
 *
 * The backend remains the authority — this is a translation of its bounds,
 * not a second rule set. Its own Zod messages are English and reach the UI
 * unchanged (a recorded backlog entry), which is why they are pre-empted here.
 *
 * Every value is checked, including the ones a locked checkbox greys out:
 * a locked field keeps its value and is still submitted, so the backend still
 * validates it.
 */
function validate(draft: Draft, takenTopicPrefixes: string[]): string | null {
  const name = draft.name.trim();
  if (name === '') return 'Ein Name ist erforderlich';
  if (name.length > 100)
    return 'Der Name darf höchstens 100 Zeichen lang sein';
  if (draft.description.trim().length > 500)
    return 'Die Beschreibung darf höchstens 500 Zeichen lang sein';
  if (draft.deviceGroup.trim().length > 64)
    return 'Die Gerätegruppe darf höchstens 64 Zeichen lang sein';
  if (draft.outdoorDevice.trim().length > 64)
    return 'Der Außensensor darf höchstens 64 Zeichen lang sein';

  const prefix = draft.fanTopicPrefix.trim();
  if (prefix.length > 200)
    return 'Das Topic-Präfix darf höchstens 200 Zeichen lang sein';
  if (/[#+]/.test(prefix))
    return 'Das Topic-Präfix darf kein # und kein + enthalten';
  if (prefix.endsWith('/')) return 'Das Topic-Präfix darf nicht auf / enden';

  const switchId = Number(draft.fanSwitchId);
  if (
    draft.fanSwitchId.trim() === '' ||
    !Number.isInteger(switchId) ||
    switchId < 0 ||
    switchId > 9
  )
    return 'Der Schaltkanal muss eine ganze Zahl zwischen 0 und 9 sein';

  if (draft.fanControlEnabled && prefix === '')
    return 'Für die Lüftersteuerung wird ein Topic-Präfix benötigt';
  // Only while fan control is on: with the switch off the backend discards the
  // prefix, so it reserves nothing and nothing clashes with it.
  if (draft.fanControlEnabled && takenTopicPrefixes.includes(prefix))
    return 'Dieses Topic-Präfix gehört bereits zu einer anderen Halle';
  if (draft.hasGrainSensors && draft.deviceGroup.trim() === '')
    return 'Für Korn-Thermometer wird eine Gerätegruppe benötigt';

  return null;
}

function toPayload(draft: Draft): CreateStockRequest {
  return {
    name: draft.name.trim(),
    description: orNull(draft.description),
    deviceGroup: orNull(draft.deviceGroup),
    outdoorDevice: orNull(draft.outdoorDevice),
    hasHumidity: draft.hasHumidity,
    hasGrainSensors: draft.hasGrainSensors,
    active: draft.active,
    fanControlEnabled: draft.fanControlEnabled,
    fanTopicPrefix: orNull(draft.fanTopicPrefix),
    fanSwitchId: Number(draft.fanSwitchId),
  };
}

/**
 * The stock configuration form, shared by create and edit (design spec §5).
 *
 * Mount it only while it is wanted: the draft is seeded from `stock` once, so
 * a kept-alive instance would show the previous stock's values.
 */
export function StockFormDialog({
  open,
  stock,
  takenTopicPrefixes = [],
  onSave,
  onCancel,
}: StockFormDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(stock));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  /**
   * True once the operator has unticked fan control on a stock that has it.
   * Compared against the stored stock, not against the draft's own history,
   * so re-ticking makes the warning disappear again.
   */
  const withdrawingFanControl =
    stock?.fanControlEnabled === true && !draft.fanControlEnabled;

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = validate(draft, takenTopicPrefixes);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(toPayload(draft));
    } catch (err) {
      setError(extractError(err, 'Die Halle konnte nicht gespeichert werden'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={stock ? 'Edit stock' : 'New stock'}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Group title="Basics">
          {stock && (
            <Field htmlFor="stock-id" label="Id">
              <Input id="stock-id" value={stock.id} readOnly />
            </Field>
          )}
          <Field htmlFor="stock-name" label="Name">
            <Input
              id="stock-name"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field htmlFor="stock-description" label="Description">
            <Input
              id="stock-description"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <Checkbox
            id="stock-active"
            label="Active"
            checked={draft.active}
            onChange={(checked) => set('active', checked)}
          />
        </Group>

        <Group title="Sensors">
          <Checkbox
            id="stock-has-grain-sensors"
            label="Grain thermometers present"
            checked={draft.hasGrainSensors}
            onChange={(checked) => set('hasGrainSensors', checked)}
          />
          <Field htmlFor="stock-device-group" label="Device group">
            <Input
              id="stock-device-group"
              value={draft.deviceGroup}
              disabled={!draft.hasGrainSensors}
              onChange={(e) => set('deviceGroup', e.target.value)}
            />
          </Field>
          <Checkbox
            id="stock-has-humidity"
            label="Humidity present"
            checked={draft.hasHumidity}
            disabled={!draft.hasGrainSensors}
            onChange={(checked) => set('hasHumidity', checked)}
          />
          <Field htmlFor="stock-outdoor-device" label="Outdoor device">
            <Input
              id="stock-outdoor-device"
              value={draft.outdoorDevice}
              onChange={(e) => set('outdoorDevice', e.target.value)}
            />
          </Field>
        </Group>

        <Group title="Fan control">
          <Checkbox
            id="stock-fan-control-enabled"
            label="Fan control enabled"
            checked={draft.fanControlEnabled}
            onChange={(checked) => set('fanControlEnabled', checked)}
          />
          {withdrawingFanControl && (
            <div className="rounded-md bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              Der Halle wird die Lüftersteuerung entzogen. Nach dem Speichern
              lässt sich der Lüfter nicht mehr über die App schalten — bitte
              vor Ort prüfen, ob er läuft, und ihn gegebenenfalls von Hand
              ausschalten.
            </div>
          )}
          <Field htmlFor="stock-fan-topic-prefix" label="Topic prefix">
            <Input
              id="stock-fan-topic-prefix"
              value={draft.fanTopicPrefix}
              disabled={!draft.fanControlEnabled}
              onChange={(e) => set('fanTopicPrefix', e.target.value)}
            />
          </Field>
          <Field htmlFor="stock-fan-switch-id" label="Switch id">
            <Input
              id="stock-fan-switch-id"
              type="number"
              step={1}
              value={draft.fanSwitchId}
              disabled={!draft.fanControlEnabled}
              onChange={(e) => set('fanSwitchId', e.target.value)}
            />
          </Field>
        </Group>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? 'Saving...' : stock ? 'Save changes' : 'Create stock'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** One labelled group of the form; `fieldset` so the legend names the group. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A checkbox sized for a thumb. Disabled only greys it out — the value it
 * carries stays in the draft and is still submitted, so re-ticking the
 * checkbox that locks it restores the previous configuration.
 */
function Checkbox({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 rounded border-input disabled:cursor-not-allowed disabled:opacity-50"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label
        htmlFor={id}
        className="text-sm font-medium data-[disabled=true]:opacity-50"
        data-disabled={disabled === true}
      >
        {label}
      </label>
    </div>
  );
}
