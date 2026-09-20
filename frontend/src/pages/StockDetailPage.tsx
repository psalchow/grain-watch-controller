import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Fan, RefreshCw, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { FanStatusCard } from '@/components/FanStatusCard';
import { SensorCard } from '@/components/SensorCard';
import { OutdoorSummary } from '@/components/OutdoorSummary';
import { StockHistorySection } from '@/components/StockHistorySection';
import { Button } from '@/components/ui/button';
import { stocksApi } from '@/api';
import { useFanStream } from '@/hooks/useFanStream';
import type { LatestReadingsResponse, Resolution } from '@/types/api';

export default function StockDetailPage() {
  const { stockId } = useParams<{ stockId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<LatestReadingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution>('day');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const {
    snapshot: fanSnapshot,
    connected: fanConnected,
    disabled: fanDisabled,
  } = useFanStream(stockId, data?.fanControlEnabled ?? false);

  // The server dropped the stream because fan control was taken out of service;
  // hide the section immediately rather than after the next manual refresh.
  const fanEnabled = (data?.fanControlEnabled ?? false) && !fanDisabled;

  const loadData = useCallback(async (showRefreshing = false) => {
    if (!stockId) return;
    if (showRefreshing) setRefreshing(true);
    setError(null);

    try {
      const response = await stocksApi.getLatestReadings(stockId);
      setData(response);
    } catch {
      setError('Sensordaten konnten nicht geladen werden. Bitte erneut versuchen.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [stockId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    loadData(true);
    setRefreshNonce((n) => n + 1);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-screen-xl px-4 py-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-1">Back</span>
          </Button>

          {data && (
            <>
              <h1 className="text-2xl font-bold">{data.stockName}</h1>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                Active
              </span>
              <OutdoorSummary
                outdoor={data.outdoor}
                className="order-last w-full lg:order-none lg:w-auto"
              />
            </>
          )}

          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-md bg-destructive/10 p-4 text-center text-destructive">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => loadData()}
            >
              Try again
            </Button>
          </div>
        ) : data ? (
          <>
            {fanEnabled && (
              <div className="mb-4">
                <FanStatusCard status={fanSnapshot?.status ?? null} connected={fanConnected} />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => navigate(`/stocks/${stockId}/fan`)}
                >
                  <Fan className="mr-2 h-4 w-4" /> Lüfter steuern
                </Button>
              </div>
            )}
            {/* Nothing to show — worded after availability rather than after
                the installation, since fanControlEnabled reports whether a
                controller is up, not whether a fan exists. */}
            {data.hasGrainSensors === false && !fanEnabled && (
              <div className="rounded-md bg-muted/50 p-4 text-center text-muted-foreground">
                <p>
                  Für diese Halle liegen weder Messwerte vor noch ist eine
                  Lüftersteuerung verfügbar.
                </p>
              </div>
            )}
            {/* Stocks without grain thermometers show fan control only; an
                absent field (cached response from an older backend) counts as
                "has sensors". */}
            {data.hasGrainSensors !== false && (
              <>
                {data.devices.length > 0 ? (
                  <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
                    {data.devices.map((device) => (
                      <SensorCard key={device.device} reading={device} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md bg-muted/50 p-4 text-center text-muted-foreground">
                    <p>Keine aktuellen Messwerte vorhanden.</p>
                  </div>
                )}
                {/* History covers up to a year and stays available while the
                    sensors are silent — that is when the trend matters most. */}
                {stockId && (
                  <StockHistorySection
                    stockId={stockId}
                    resolution={resolution}
                    onResolutionChange={setResolution}
                    refreshNonce={refreshNonce}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <p>No sensor data available</p>
          </div>
        )}
      </main>
    </div>
  );
}
