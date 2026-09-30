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
