export function getTemperatureColour(avgTemp: number): string {
  if (avgTemp < 13) return '#22c55e';
  if (avgTemp < 22) return '#eab308';
  if (avgTemp < 30) return '#f97316';
  return '#ef4444';
}

export function calculateAverage(
  bottom: number | null,
  mid: number | null,
  top: number | null
): number | null {
  const values = [bottom, mid, top].filter(
    (v): v is number => v !== null
  );
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'unknown';

  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} d ago`;
}
