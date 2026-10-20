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
  const {
    temperature,
    humidity,
    dewPoint,
    absoluteHumidity,
    lastMeasurement,
    offline,
    offlineReason,
  } = outdoor;

  /**
   * Exactly one of the two measurements is present. Preferably taken from the
   * response so the rule lives in one place; derived locally only when the
   * field is absent, which a cached response from a pre-upgrade backend is.
   */
  const partnerMissing =
    offlineReason === 'partner-missing' ||
    (offlineReason === undefined &&
      offline === true &&
      (temperature === null) !== (humidity === null));

  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm',
        offline && 'opacity-50',
        className,
      )}
    >
      <span className="text-muted-foreground">Außen</span>
      <span className="font-semibold">{fmt1(temperature)}°C</span>
      <span className="text-muted-foreground">{fmtInt(humidity)}%</span>
      <span className="text-[10px] text-muted-foreground">
        {`Tp ${fmt1(dewPoint)}°C · ${fmt1(absoluteHumidity)} g/m³`}
      </span>
      <span className="text-[10px] text-muted-foreground/60">
        {/* A missing half gets its own wording: the age belongs to the value
            that is still there, so a bare "Offline" would contradict it. The
            reason comes from the response; inferring it from the values here
            would duplicate the backend's rule and drift from it. */}
        {partnerMissing
          ? 'Wert fehlt · '
          : offline
            ? 'Offline · '
            : ''}
        {formatRelativeTime(lastMeasurement)}
      </span>
    </div>
  );
}
