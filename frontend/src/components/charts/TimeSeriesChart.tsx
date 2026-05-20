import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTick } from '@/lib/chartTickFormat';

export interface TimeSeries {
  label: string;
  colour: string;
  points: { t: string; v: number | null }[];
}

export interface ThresholdBand {
  from: number;
  to: number;
  colour: string;
  opacity?: number;
}

export interface TimeSeriesChartProps {
  title: string;
  series: TimeSeries[];
  intervalSeconds: number;
  unit: string;
  yDomain?: [number, number];
  thresholdBands?: ThresholdBand[];
  height?: number;
}

interface ChartRow {
  t: string;
  [seriesLabel: string]: string | number | null;
}

function toChartRows(series: TimeSeries[]): ChartRow[] {
  const byTime = new Map<string, ChartRow>();
  for (const s of series) {
    for (const point of s.points) {
      const existing = byTime.get(point.t) ?? { t: point.t };
      existing[s.label] = point.v;
      byTime.set(point.t, existing);
    }
  }
  return Array.from(byTime.values()).sort((a, b) =>
    a.t < b.t ? -1 : a.t > b.t ? 1 : 0,
  );
}

export function TimeSeriesChart({
  title,
  series,
  intervalSeconds,
  unit,
  yDomain,
  thresholdBands,
  height = 240,
}: TimeSeriesChartProps) {
  const data = toChartRows(series);
  const isEmpty = data.length === 0;

  return (
    <div className="rounded-md border p-3">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {isEmpty ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
          No history data available for the selected range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            {thresholdBands?.map((band, i) => (
              <ReferenceArea
                key={i}
                y1={Number.isFinite(band.from) ? band.from : undefined}
                y2={Number.isFinite(band.to) ? band.to : undefined}
                fill={band.colour}
                fillOpacity={band.opacity ?? 0.08}
                ifOverflow="hidden"
              />
            ))}
            <XAxis
              dataKey="t"
              tickFormatter={(value: string) => formatTick(value, intervalSeconds)}
              minTickGap={32}
            />
            <YAxis
              domain={yDomain ?? ['auto', 'auto']}
              allowDataOverflow={yDomain !== undefined}
              tickFormatter={(value: number) => `${value}${unit}`}
              width={48}
            />
            <Tooltip
              labelFormatter={(value: string) => formatTick(value, intervalSeconds)}
              formatter={(value: number) =>
                value === null || value === undefined ? '—' : `${value.toFixed(1)}${unit}`
              }
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => (
              <Line
                key={s.label}
                type="monotone"
                dataKey={s.label}
                stroke={s.colour}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
