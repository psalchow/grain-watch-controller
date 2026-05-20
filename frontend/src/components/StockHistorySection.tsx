import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { stocksApi } from '@/api';
import type { Resolution, StockHistoryResponse, SeriesPoint } from '@/types/api';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart, type ThresholdBand, type TimeSeries } from '@/components/charts/TimeSeriesChart';
import { HistoryRangeTabs } from '@/components/HistoryRangeTabs';
import { getDeviceColour } from '@/lib/deviceColours';

const TEMPERATURE_BANDS: ThresholdBand[] = [
  { from: -Infinity, to: 13, colour: '#22c55e', opacity: 0.08 },
  { from: 13, to: 22, colour: '#eab308', opacity: 0.08 },
  { from: 22, to: 30, colour: '#f97316', opacity: 0.08 },
  { from: 30, to: Infinity, colour: '#ef4444', opacity: 0.1 },
];

export interface StockHistorySectionProps {
  stockId: string;
  resolution: Resolution;
  onResolutionChange: (next: Resolution) => void;
  refreshNonce: number;
}

function buildSeries(
  devices: string[],
  layer: SeriesPoint[][],
): TimeSeries[] {
  return devices.map((device, idx) => ({
    label: `Sensor ${device}`,
    colour: getDeviceColour(device),
    points: layer[idx] ?? [],
  }));
}

export function StockHistorySection({
  stockId,
  resolution,
  onResolutionChange,
  refreshNonce,
}: StockHistorySectionProps) {
  const [data, setData] = useState<StockHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const loadHistory = useCallback(async () => {
    try {
      const response = await stocksApi.getStockHistory(stockId, resolution);
      setData(response);
      setError(null);
    } catch {
      setError('Failed to load history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [stockId, resolution]);

  useEffect(() => {
    setLoading(true);
    loadHistory();
    // refreshNonce and retryCount intentionally included to trigger re-fetch
  }, [loadHistory, refreshNonce, retryCount]);

  return (
    <section className="mt-6">
      <HistoryRangeTabs value={resolution} onChange={onResolutionChange} />

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md bg-destructive/10 p-4 text-center text-destructive">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setRetryCount((c) => c + 1)}
          >
            Try again
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="flex flex-col gap-3 mt-3">
          <TimeSeriesChart
            title="Top Temperatures"
            series={buildSeries(data.devices, data.series.temperature.top)}
            intervalSeconds={data.intervalSeconds}
            unit="°C"
            yDomain={[0, 40]}
            thresholdBands={TEMPERATURE_BANDS}
          />
          <TimeSeriesChart
            title="Mid Temperatures"
            series={buildSeries(data.devices, data.series.temperature.mid)}
            intervalSeconds={data.intervalSeconds}
            unit="°C"
            yDomain={[0, 40]}
            thresholdBands={TEMPERATURE_BANDS}
          />
          <TimeSeriesChart
            title="Bottom Temperatures"
            series={buildSeries(data.devices, data.series.temperature.bottom)}
            intervalSeconds={data.intervalSeconds}
            unit="°C"
            yDomain={[0, 40]}
            thresholdBands={TEMPERATURE_BANDS}
          />
        </div>
      )}
    </section>
  );
}
