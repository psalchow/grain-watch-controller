import type { OutdoorConditions } from '@/types/api';
import { formatRelativeTime } from '@/lib/temperature';

interface OutdoorConditionsCardProps {
  outdoor: OutdoorConditions;
}

const fmt1 = (value: number | null): string =>
  value !== null ? value.toFixed(1) : '–';

const fmtInt = (value: number | null): string =>
  value !== null ? String(Math.round(value)) : '–';

export function OutdoorConditionsCard({ outdoor }: OutdoorConditionsCardProps) {
  const { temperature, humidity, dewPoint, absoluteHumidity, lastMeasurement } =
    outdoor;

  return (
    <div className="rounded-lg bg-card p-3">
      <div className="text-xs text-muted-foreground mb-1">Außen</div>

      <div className="flex items-baseline gap-4">
        <div className="text-2xl font-bold">{fmt1(temperature)}°C</div>
        <div className="text-lg text-muted-foreground">{fmtInt(humidity)}%</div>
      </div>

      <div className="text-[10px] text-muted-foreground mt-1.5">
        Taupunkt {fmt1(dewPoint)}°C · abs. Feuchte {fmt1(absoluteHumidity)} g/m³
      </div>

      <div className="text-[9px] text-muted-foreground/60 mt-1.5">
        {formatRelativeTime(lastMeasurement)}
      </div>
    </div>
  );
}
