import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { SensorCard } from '@/components/SensorCard';
import { Button } from '@/components/ui/button';
import { stocksApi } from '@/api';
import { LatestReadingsResponse } from '@/types/api';

export default function StockDetailPage() {
  const { stockId } = useParams<{ stockId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<LatestReadingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (showRefreshing = false) => {
    if (!stockId) return;
    if (showRefreshing) setRefreshing(true);
    setError(null);

    try {
      const response = await stocksApi.getLatestReadings(stockId);
      setData(response);
    } catch {
      setError('Failed to load sensor data. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [stockId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-screen-xl px-4 py-6">
        {/* Header row */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-1">Back</span>
          </Button>

          {data && (
            <>
              <h1 className="text-2xl font-bold">{data.stockName}</h1>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                Active
              </span>
            </>
          )}

          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData(true)}
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

        {/* Content */}
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
        ) : data && data.devices.length > 0 ? (
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
            {data.devices.map((device) => (
              <SensorCard key={device.device} reading={device} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <p>No sensor data available</p>
          </div>
        )}
      </main>
    </div>
  );
}
