const TZ = 'Europe/Berlin';
const LOCALE = 'en-GB';

const HOUR_MINUTE = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const WEEKDAY_HM = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DAY_MONTH = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
});

const MONTH_SHORT = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  month: 'short',
});

export function formatTick(iso: string, intervalSeconds: number): string {
  const date = new Date(iso);
  if (intervalSeconds <= 1800) {
    return HOUR_MINUTE.format(date);
  }
  if (intervalSeconds <= 21600) {
    // formatToParts so we can present "Tue 10:30" reliably across locales.
    const parts = WEEKDAY_HM.formatToParts(date);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
    return `${weekday} ${hour}:${minute}`;
  }
  if (intervalSeconds <= 43200) {
    return DAY_MONTH.format(date).replace('/', '.');
  }
  return MONTH_SHORT.format(date);
}
