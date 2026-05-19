/**
 * Time-range helper for the stock history endpoint.
 *
 * Computes the current calendar period (day / week / month / year)
 * in the configured local time zone and returns the corresponding
 * UTC instants together with the aggregation interval to use.
 */

const LOCAL_TIME_ZONE = 'Europe/Berlin';

export type Resolution = 'day' | 'week' | 'month' | 'year';

export interface TimeRange {
  /** Inclusive UTC start of the current period. */
  fromUtc: Date;
  /** UTC instant of the "now" reference passed to the helper. */
  toUtc: Date;
  /** Aggregation bucket size in seconds (30m / 6h / 12h / 1d). */
  intervalSeconds: number;
}

const INTERVALS: Record<Resolution, number> = {
  day: 1_800,
  week: 21_600,
  month: 43_200,
  year: 86_400,
};

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  weekday: number; // 1=Monday … 7=Sunday
}

/** Returns the calendar parts of `date` in the local time zone. */
function getLocalParts(date: Date): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayMap[get('weekday')] ?? 1,
  };
}

/** Returns the offset of the local time zone at `date`, in minutes east of UTC. */
function getLocalOffsetMinutes(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TIME_ZONE,
    timeZoneName: 'longOffset',
  });
  const value =
    formatter.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? '';
  // value looks like 'GMT+01:00', 'GMT+02:00', or just 'GMT'
  const match = value.match(/GMT(?:([+-])(\d{2}):(\d{2}))?/);
  if (!match) return 0;
  if (!match[1]) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes);
}

/** Returns the UTC instant for local midnight of the given local date. */
function localMidnightUtc(year: number, month: number, day: number): Date {
  // First approximation: treat the local date components as if they were UTC.
  // We then subtract the local offset to get the correct UTC instant.
  const approx = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMin = getLocalOffsetMinutes(approx);
  return new Date(approx.getTime() - offsetMin * 60_000);
}

export function getRange(resolution: Resolution, now: Date): TimeRange {
  const parts = getLocalParts(now);

  let fromUtc: Date;
  switch (resolution) {
    case 'day':
      fromUtc = localMidnightUtc(parts.year, parts.month, parts.day);
      break;
    case 'week': {
      // ISO weekday: Monday=1 … Sunday=7. Subtract (weekday - 1) days.
      const mondayDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
      mondayDate.setUTCDate(mondayDate.getUTCDate() - (parts.weekday - 1));
      fromUtc = localMidnightUtc(
        mondayDate.getUTCFullYear(),
        mondayDate.getUTCMonth() + 1,
        mondayDate.getUTCDate(),
      );
      break;
    }
    case 'month':
      fromUtc = localMidnightUtc(parts.year, parts.month, 1);
      break;
    case 'year':
      fromUtc = localMidnightUtc(parts.year, 1, 1);
      break;
  }

  return {
    fromUtc,
    toUtc: new Date(now.getTime()),
    intervalSeconds: INTERVALS[resolution],
  };
}
