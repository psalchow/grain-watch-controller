/**
 * Helpers for the InfluxQL duration strings used in the configuration.
 */

/** Milliseconds per InfluxQL duration unit. */
const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/** Matches an InfluxQL duration such as '30s', '6h' or '26w'. */
const DURATION_PATTERN = /^(\d+)([smhdw])$/;

/**
 * Converts an InfluxQL duration to milliseconds.
 *
 * @param value - Duration string (e.g. '6h')
 * @returns Duration in milliseconds, or null if the string is malformed
 *
 * @example
 * parseDurationMs('2h'); // 7200000
 * parseDurationMs('2x'); // null
 */
export function parseDurationMs(value: string): number | null {
  const match = DURATION_PATTERN.exec(value);
  if (!match) return null;

  const amount = Number(match[1]);
  const unitMs = DURATION_UNIT_MS[match[2] as string];
  if (unitMs === undefined) return null;

  return amount * unitMs;
}
