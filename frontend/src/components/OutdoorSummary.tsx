import type { OutdoorConditions } from '@/types/api';
import { formatRelativeTime } from '@/lib/temperature';
import { cn } from '@/lib/utils';

interface OutdoorSummaryProps {
  outdoor: OutdoorConditions;
  className?: string;
}

const fmt1 = (value: number | null): string =>
  value !== null ? value.toFixed(1) : '–';

const fmtInt = (value: number | null): string =>
  value !== null ? String(Math.round(value)) : '–';

/**
 * Compact, inline outdoor conditions chip for the page header.
 *
 * Wraps onto its own line on narrow viewports via the parent's flex-wrap.
 */
export function OutdoorSummary({ outdoor, className }: OutdoorSummaryProps) {
  const { temperature, humidity, dewPoint, absoluteHumidity, lastMeasurement } =
    outdoor;

  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm',
        className,
      )}
    >
      <span className="text-muted-foreground">Außen</span>
      <span className="font-semibold">{fmt1(temperature)}°C</span>
      <span className="text-muted-foreground">{fmtInt(humidity)}%</span>
      <span className="text-[10px] text-muted-foreground">
        Tp {fmt1(dewPoint)}°C · {fmt1(absoluteHumidity)} g/m³
      </span>
      <span className="text-[10px] text-muted-foreground/60">
        {formatRelativeTime(lastMeasurement)}
      </span>
    </div>
  );
}
