/**
 * A y-axis domain that fits the given readings: padded on both sides, widened
 * to whole units, and never narrower than `minSpan`, so a nearly flat series
 * is not stretched into what looks like a dramatic swing. `undefined` when
 * there is no finite reading to fit.
 */
export function fitDomain(
  values: Iterable<number | null>,
  { padding = 1, minSpan = 5 }: { padding?: number; minSpan?: number } = {},
): [number, number] | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return undefined;

  let lower = Math.floor(min - padding);
  let upper = Math.ceil(max + padding);
  const shortfall = minSpan - (upper - lower);
  if (shortfall > 0) {
    lower -= Math.floor(shortfall / 2);
    upper += Math.ceil(shortfall / 2);
  }
  return [lower, upper];
}
