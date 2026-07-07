/**
 * Psychrometric calculations for outdoor air.
 *
 * Pure functions; callers must ensure inputs are present before calling.
 */

/** Magnus formula constants (WMO/Sonntag), shared by both calculations. */
const MAGNUS_A = 17.62;
const MAGNUS_B = 243.12; // °C

/** Saturation vapour pressure at 0 °C, in hPa. */
const SATURATION_PRESSURE_0C = 6.112; // hPa

/** Gas-law conversion factor for absolute humidity (g·K/(hPa·m³)). */
const ABSOLUTE_HUMIDITY_FACTOR = 2.1674;

/** Offset to convert degrees Celsius to Kelvin. */
const CELSIUS_TO_KELVIN = 273.15;

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
  const saturationPressure =
    SATURATION_PRESSURE_0C *
    Math.exp((MAGNUS_A * tempC) / (MAGNUS_B + tempC));
  return (
    (saturationPressure * relHumidity * ABSOLUTE_HUMIDITY_FACTOR) /
    (CELSIUS_TO_KELVIN + tempC)
  );
}
