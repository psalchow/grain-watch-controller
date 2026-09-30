export * from './types';
export { evaluate } from './evaluate';
export { AutomationService } from './automation.service';
export type {
  AutomationState,
  AutomationServiceDeps,
  AutomationReadingSource,
  DisableCause,
} from './automation.service';

import type { AutomationService } from './automation.service';

/**
 * The running automation service, or null.
 *
 * The same module-level accessor pair `services/fan` uses for its manager, and
 * for the same reason: `bootstrap.ts` builds the service, and the HTTP layer
 * reaches it without every route carrying it down. Null is an ordinary case —
 * `initFanControl` returns early when no stock has fan control, and then no
 * service is ever constructed.
 *
 * Nothing inside this module reads the pair, so it can live in the barrel
 * without the import cycle `services/fan` had to break.
 */
let service: AutomationService | null = null;

export function setAutomationService(s: AutomationService | null): void {
  service = s;
}

export function getAutomationService(): AutomationService | null {
  return service;
}
