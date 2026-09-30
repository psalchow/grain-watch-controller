import { Fan, AlertTriangle, Wifi, WifiOff, HelpCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { translateDeviceMessage } from '@/lib/messages';
import type { FanState, FanStatus } from '@/types/fan';

const STATE_LABEL: Record<FanState, string> = {
  OFF: 'Aus',
  TURN_ON_PENDING: 'Wird eingeschaltet…',
  ON: 'Läuft',
  TURN_OFF_PENDING: 'Wird ausgeschaltet…',
  FAULT: 'Fehler',
};

const PENDING: FanState[] = ['TURN_ON_PENDING', 'TURN_OFF_PENDING'];

/**
 * How each reachability value presents itself. The key names mirror the three
 * values for readability only — never index this map with a value off the
 * wire. A key such as 'constructor' would resolve through `Object.prototype`
 * and hand back something that is not a component, past any nullish guard, and
 * React blanks the page on it. Select by explicit comparison instead, as
 * `ReachabilityBadge` does.
 *
 * Unreachable is yellow rather than red because red is the device's own alarm.
 * A control nobody can reach is serious — commands do not arrive — but it is
 * not a fault the device reported, and levelling the two would flatten the
 * difference.
 */
const REACHABILITY = {
  true: { Icon: Wifi, label: 'Steuerung erreichbar', tone: 'bg-muted text-muted-foreground' },
  false: {
    Icon: WifiOff,
    label: 'Steuerung nicht erreichbar',
    tone: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  null: { Icon: HelpCircle, label: 'Erreichbarkeit unbekannt', tone: 'bg-muted text-muted-foreground' },
} as const;

/**
 * Says whether the fan control answers, in all three of its states.
 *
 * Shown permanently rather than only on failure: an absent badge would leave
 * "answers" and "never heard from" looking alike, and the state the card
 * reports above is only worth as much as the control's reachability.
 *
 * `stale` marks the value as belonging to a past moment: a closed stream means
 * no update can arrive. It is the single source for the dimming — the styling
 * hangs off the attribute rather than repeating the condition — and the
 * 'Verbindung…' hint beside the badge supplies the reason.
 */
function ReachabilityBadge({ reachable, stale }: { reachable: boolean | null; stale: boolean }) {
  // Matched against the values themselves rather than indexed by their string
  // form: the snapshot arrives as unvalidated JSON, and indexing would resolve
  // a key like 'constructor' through Object.prototype — past any nullish guard
  // — leaving an undefined component to blank the page. Anything that is not
  // one of the two booleans reads as unknown.
  const { Icon, label, tone } =
    reachable === true
      ? REACHABILITY.true
      : reachable === false
        ? REACHABILITY.false
        : REACHABILITY.null;

  return (
    <span
      data-stale={stale}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
        'data-[stale=true]:opacity-50',
        tone,
      )}
    >
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

export function FanStatusCard({
  status,
  connected,
}: {
  status: FanStatus | null;
  connected: boolean;
}) {
  const state = status?.state ?? 'OFF';
  const isPending = PENDING.includes(state);
  const isOn = state === 'ON';

  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2">
        <Fan className={cn('h-5 w-5', isOn && 'animate-spin text-green-600')} />
        <span className="font-medium">Lüfter</span>
        {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-sm font-semibold">
          {status ? STATE_LABEL[state] : '—'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {status?.lastAlert && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" /> Alarm: {translateDeviceMessage(status.lastAlert.message)}
          </span>
        )}
        {status?.lastWarning && (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            <AlertTriangle className="h-3 w-3" /> Warnung: {translateDeviceMessage(status.lastWarning.message)}
          </span>
        )}
        {status?.contactorEngaged && !status.desiredOn && (
          // The backend cannot open a contactor held by hand (design spec §6):
          // without this the locally running fan would be invisible in the app.
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            <AlertTriangle className="h-3 w-3" /> Gebläse läuft, vor Ort geschaltet
          </span>
        )}
        {status && (
          <ReachabilityBadge reachable={status.fanControlReachable} stale={!connected} />
        )}
        {!connected && (
          <span className="text-xs text-muted-foreground/60">Verbindung…</span>
        )}
      </div>
    </div>
  );
}
