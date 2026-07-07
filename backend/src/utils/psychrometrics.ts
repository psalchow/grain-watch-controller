/**
 * Psychrometric calculations for outdoor air.
 *
 * Pure functions; callers must ensure inputs are present before calling.
 */

/** Magnus formula constants (WMO). */
const MAGNUS_A = 17.62;
const MAGNUS_B = 243.12; // °C

/**
 * Dew point in °C from air temperature and relative humidity.
 *
 * @param tempC - Air temperature in °C
 * @param relHumidity - Relative humidity as a percentage (0–100)
 * @returns Dew point in °C
 */
export function dewPoint(tempC: number, relHumidity: number): number {
  const alpha =
    (MAGNUS_A * tempC) / (MAGNUS_B + tempC) + Math.log(relHumidity / 100);
  return (MAGNUS_B * alpha) / (MAGNUS_A - alpha);
}

/**
 * Absolute humidity in g/m³ from air temperature and relative humidity.
 *
 * @param tempC - Air temperature in °C
 * @param relHumidity - Relative humidity as a percentage (0–100)
 * @returns Absolute humidity in g/m³
 */
export function absoluteHumidity(tempC: number, relHumidity: number): number {
  const saturationPressure = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
  return (saturationPressure * relHumidity * 2.1674) / (273.15 + tempC);
}
