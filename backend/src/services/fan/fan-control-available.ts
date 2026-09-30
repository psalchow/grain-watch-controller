import { getFanManager } from './manager-registry';

/**
 * Whether the fan endpoints will serve this stock.
 *
 * Mirrors what `FanHttpController` requires: the stock row still asks for fan
 * control *and* a controller exists for it. The row alone would advertise a fan
 * nothing is wired up for; the map alone would keep advertising one whose row
 * was disabled underneath the running process. It says nothing about the broker
 * being reachable — controllers are built from the wiring at startup, before any
 * connection exists. Live reachability travels as `fanControlReachable` in the
 * fan status instead.
 */
export const fanControlAvailable = (stock: {
  id: string;
  fanControlEnabled: boolean;
}): boolean =>
  stock.fanControlEnabled && getFanManager()?.getController(stock.id) != null;

/**
 * Whether this stock can be driven by the automation (design spec §3.2).
 *
 * Composes `fanControlAvailable` — a fan the endpoints refuse to serve is one
 * the automation must not drive either — with the grain thermometers. The
 * second half is a genuine precondition in v1, not a convenience: only the
 * differential rule is implemented, so without thermometers rule 1 holds
 * permanently and the automation could never switch on.
 *
 * One predicate for all three readers — the HTTP snapshot, the stock list and
 * the evaluation cycle — because the implication runs one way only:
 * `automationAvailable` implies `fanControlAvailable`, never the reverse. Three
 * copies of that conjunction are three chances for the halves to drift apart on
 * a decision about driving a fan unattended.
 */
export const automationAvailable = (stock: {
  id: string;
  fanControlEnabled: boolean;
  hasGrainSensors: boolean;
}): boolean => fanControlAvailable(stock) && stock.hasGrainSensors;
