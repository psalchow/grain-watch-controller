import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { FanStatusCard } from '@/components/FanStatusCard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { translateDeviceMessage } from '@/lib/messages';
import { fanApi } from '@/api/fan';
import { useFanStream } from '@/hooks/useFanStream';
import type { FanSnapshot } from '@/types/fan';

const PENDING = ['TURN_ON_PENDING', 'TURN_OFF_PENDING'];

/** German labels for the event kinds recorded in the audit log. */
const EVENT_LABEL: Record<string, string> = {
  command: 'Schaltbefehl',
  success: 'Quittiert',
  safety_shutoff: 'Sicherheitsabschaltung',
  warning: 'Warnung',
  alert: 'Alarm',
  status: 'Statusmeldung',
  online_change: 'Verbindung geändert',
  watchdog_off: 'Zeitüberschreitung, abgeschaltet',
  stand_down: 'Steuerung entzogen',
  recovery: 'Zustand wiederhergestellt',
};

/** Event kinds that record a problem, highlighted in the history. */
const PROBLEM_KINDS = ['warning', 'alert', 'safety_shutoff', 'watchdog_off'];

/** Reads the device message out of an event payload, when it carries one. */
function eventMessage(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return translateDeviceMessage(message);
  }
  return null;
}

export default function FanControlPage() {
  const { stockId } = useParams<{ stockId: string }>();
  const navigate = useNavigate();
  const [initial, setInitial] = useState<FanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The status load and the stream race on mount. A 404 from either means the
  // same thing, so both feed the notice — otherwise the page briefly offers an
  // enabled switch for a hall that has no fan control.
  const [notAvailable, setNotAvailable] = useState(false);

  const { snapshot: live, connected, disabled } = useFanStream(stockId, true);

  useEffect(() => {
    if (!stockId) return;
    setNotAvailable(false);
    fanApi
      .getStatus(stockId)
      .then(setInitial)
      .catch((err: { response?: { status?: number } }) => {
        if (err?.response?.status === 404) {
          setNotAvailable(true);
          return;
        }
        setError('Status konnte nicht geladen werden.');
      });
  }, [stockId]);

  const snapshot = live ?? initial;
  const state = snapshot?.status.state ?? 'OFF';
  const isPending = PENDING.includes(state) || busy;

  const send = useCallback(
    async (action: 'on' | 'off') => {
      if (!stockId) return;
      setBusy(true);
      setError(null);
      try {
        setInitial(await fanApi.sendCommand(stockId, action));
      } catch {
        setError('Schaltbefehl fehlgeschlagen.');
      } finally {
        setBusy(false);
      }
    },
    [stockId],
  );

  const renderButton = () => {
    if (isPending) {
      return (
        <Button size="lg" disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wird quittiert…
        </Button>
      );
    }
    if (state === 'ON') {
      return <Button size="lg" variant="destructive" onClick={() => send('off')}>Ausschalten</Button>;
    }
    if (state === 'FAULT') {
      return <Button size="lg" onClick={() => send('on')}>Erneut einschalten</Button>;
    }
    return <Button size="lg" onClick={() => send('on')}>Einschalten</Button>;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/stocks/${stockId}`)}>
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-1">Zurück</span>
          </Button>
          <h1 className="text-2xl font-bold">Lüftersteuerung</h1>
        </div>

        {/* The server ended the stream because fan control was taken out of
            service. Showing the last snapshot with a live-looking button would
            invite a command that now answers 404. */}
        {disabled || notAvailable ? (
          <div className="rounded-md bg-muted/50 p-4 text-center text-muted-foreground">
            <p>Für diese Halle steht keine Lüftersteuerung zur Verfügung.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => navigate(`/stocks/${stockId}`)}
            >
              Zur Halle
            </Button>
          </div>
        ) : (
          <>
            <FanStatusCard status={snapshot?.status ?? null} connected={connected} />

            <div className="mt-6 flex justify-center">{renderButton()}</div>

            {error && (
              <p className="mt-4 text-center text-sm text-destructive">{error}</p>
            )}
          </>
        )}

        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Verlauf</h2>
          <ul className="space-y-1 text-xs">
            {(snapshot?.events ?? []).map((ev) => {
              const message = eventMessage(ev.payload);
              const isProblem = PROBLEM_KINDS.includes(ev.kind);
              return (
                <li key={ev.id} className="flex flex-wrap gap-2 border-b py-1">
                  <span className="text-muted-foreground/60">
                    {new Date(ev.ts).toLocaleString('de-DE')}
                  </span>
                  <span className={cn('font-medium', isProblem && 'text-destructive')}>
                    {EVENT_LABEL[ev.kind] ?? ev.kind}
                  </span>
                  {message && <span className="text-muted-foreground">{message}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
