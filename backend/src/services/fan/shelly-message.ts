import { ShellyMessageType, ShellyMonitorMessage } from './types';

const VALID_TYPES: ShellyMessageType[] = ['success', 'warning', 'alert', 'safety_shutoff'];

/**
 * Parses a Shelly monitor payload. Returns null for malformed JSON, unknown
 * `type`, or missing/mis-typed fields. Dispatch downstream on `.type`.
 */
export function parseShellyMonitorMessage(raw: string): ShellyMonitorMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o['type'] !== 'string' || !VALID_TYPES.includes(o['type'] as ShellyMessageType)) {
    return null;
  }
  if (
    typeof o['message'] !== 'string' ||
    typeof o['switchState'] !== 'boolean' ||
    typeof o['inputState'] !== 'boolean' ||
    typeof o['timestamp'] !== 'number'
  ) {
    return null;
  }
  return {
    type: o['type'] as ShellyMessageType,
    message: o['message'] as string,
    switchState: o['switchState'] as boolean,
    inputState: o['inputState'] as boolean,
    timestamp: o['timestamp'] as number,
  };
}
