import { Fan, AlertTriangle, WifiOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FanState, FanStatus } from '@/types/fan';

const STATE_LABEL: Record<FanState, string> = {
  OFF: 'Aus',
  TURN_ON_PENDING: 'Wird eingeschaltet…',
  ON: 'Läuft',
  TURN_OFF_PENDING: 'Wird ausgeschaltet…',
  FAULT: 'Fehler',
};

const PENDING: FanState[] = ['TURN_ON_PENDING', 'TURN_OFF_PENDING'];

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
            <AlertTriangle className="h-3 w-3" /> Alarm: {status.lastAlert.message}
          </span>
        )}
        {status?.lastWarning && (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            <AlertTriangle className="h-3 w-3" /> Warnung: {status.lastWarning.message}
          </span>
        )}
        {status?.shellyOnline === false && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <WifiOff className="h-3 w-3" /> Shelly offline
          </span>
        )}
        {!connected && (
          <span className="text-xs text-muted-foreground/60">Verbindung…</span>
        )}
      </div>
    </div>
  );
}
