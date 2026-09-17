import { DeviceReading } from '@/types/api';
import { getTemperatureColour, calculateAverage, formatRelativeTime } from '@/lib/temperature';
import { cn } from '@/lib/utils';

interface SensorCardProps {
  reading: DeviceReading;
}

export function SensorCard({ reading }: SensorCardProps) {
  const { temperature, lastMeasurement, device, offline } = reading;
  const avg = calculateAverage(temperature.bottom, temperature.mid, temperature.top);
  // The colour is the only alarm channel in the app, so a stale reading keeps
  // it: a probe in a hot spot tends to go silent exactly when it matters.
  // Staleness is carried by the dimmed card and the "Offline" label instead.
  const colour = avg !== null ? getTemperatureColour(avg) : undefined;

  return (
    <div
      className={cn('rounded-lg bg-card p-3 text-center', offline && 'opacity-50')}
      style={{ borderTop: `3px solid ${colour ?? 'var(--color-border)'}` }}
    >
      <div className="text-xs text-muted-foreground mb-1">
        Sensor {device}
      </div>

      {avg !== null ? (
        <>
          <div
            className="text-2xl font-bold mb-1.5"
            style={colour ? { color: colour } : undefined}
          >
            {avg.toFixed(1)}°C
          </div>
          <div className="flex justify-center gap-1.5 text-[10px] text-muted-foreground">
            <span>↓{temperature.bottom?.toFixed(1) ?? '–'}</span>
            <span>●{temperature.mid?.toFixed(1) ?? '–'}</span>
            <span>↑{temperature.top?.toFixed(1) ?? '–'}</span>
          </div>
        </>
      ) : (
        <div className="text-2xl font-bold mb-1.5 text-muted-foreground">
          N/A
        </div>
      )}

      <div className="text-[9px] text-muted-foreground/60 mt-1.5">
        {offline ? `Offline · ${formatRelativeTime(lastMeasurement)}` : formatRelativeTime(lastMeasurement)}
      </div>
    </div>
  );
}
