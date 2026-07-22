import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { FanStatusCard } from '@/components/FanStatusCard';
import { Button } from '@/components/ui/button';
import { fanApi } from '@/api/fan';
import { useFanStream } from '@/hooks/useFanStream';
import type { FanSnapshot } from '@/types/fan';

const PENDING = ['TURN_ON_PENDING', 'TURN_OFF_PENDING'];

export default function FanControlPage() {
  const { stockId } = useParams<{ stockId: string }>();
  const navigate = useNavigate();
  const [initial, setInitial] = useState<FanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { snapshot: live, connected } = useFanStream(stockId, true);

  useEffect(() => {
    if (!stockId) return;
    fanApi.getStatus(stockId).then(setInitial).catch(() => setError('Status konnte nicht geladen werden.'));
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

        <FanStatusCard status={snapshot?.status ?? null} connected={connected} />

        <div className="mt-6 flex justify-center">{renderButton()}</div>

        {error && (
          <p className="mt-4 text-center text-sm text-destructive">{error}</p>
        )}

        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Verlauf</h2>
          <ul className="space-y-1 text-xs">
            {(snapshot?.events ?? []).map((ev) => (
              <li key={ev.id} className="flex gap-2 border-b py-1">
                <span className="text-muted-foreground/60">{ev.ts}</span>
                <span className="font-medium">{ev.kind}</span>
                <span className="text-muted-foreground">{ev.source}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
