import { config } from './config';
import { initDb, closeDb, getDb } from './db';
import { runMigrations } from './db/migrate';
import { seedStocks } from './db/seed';
import {
  StockRepository,
  FanStateRepository,
  FanEventsRepository,
  AutomationRepository,
} from './db/repositories';
import { getUserService, influxService } from './services';
import { createMqttService } from './services/mqtt';
import { FanControlManager, selectFanStocks, setFanManager, getFanManager } from './services/fan';
import { AutomationService, setAutomationService, getAutomationService } from './services/automation';

interface BootstrapResult {
  defaultUsersCreated: boolean;
  defaultAdminUsername?: string;
}

export async function bootstrapApplication(): Promise<BootstrapResult> {
  const result: BootstrapResult = { defaultUsersCreated: false };

  const db = initDb({ path: config.database.path });
  runMigrations(db);
  await seedStocks(new StockRepository(db));

  try {
    const adminProfile = await getUserService().initializeDefaultUsers();
    if (adminProfile !== null) {
      result.defaultUsersCreated = true;
      result.defaultAdminUsername = adminProfile.username;
      console.log('\n========================================');
      console.log('Default Admin User Created');
      console.log('========================================');
      console.log(`Environment: ${config.nodeEnv}`);
      console.log(`Username: ${adminProfile.username}`);
      console.log('Password: changeme123');
      console.log('========================================');
      console.log('IMPORTANT: Change the default password immediately!');
      console.log('========================================\n');
    } else {
      console.log('User bootstrap: Users already exist, skipping default user creation');
    }
    await initFanControl();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to bootstrap application:', message);
    closeDb();
    throw new Error(`Bootstrap failed: ${message}`);
  }
}

/**
 * Builds and starts the fan control manager for all fan-enabled stocks.
 * No-op when no stock has fan control configured. Recovers desired state.
 * Opens the live MQTT connection — not exercised by unit tests.
 */
export async function initFanControl(): Promise<void> {
  const db = getDb();
  const stocks = await new StockRepository(db).findAll();
  const fanStocks = selectFanStocks(stocks);

  // A row cleared while the service was down leaves a stale desired state
  // behind, which `recover()` would resume the next time fan control is enabled
  // again. Clearing it needs no controller — and no command either: a fan is
  // not left running through a revocation, and the Shelly switches itself off
  // without a keep-alive signal anyway.
  const stateRepo = new FanStateRepository(db);
  for (const stock of stocks) {
    // Keyed on the row's own flag, not on whether the stock could be wired: a
    // missing topic prefix is a misconfiguration to be fixed, and wiping the
    // desired state would lose what `recover()` should resume afterwards.
    if (stock.fanControlEnabled) continue;
    const persisted = stateRepo.get(stock.id);
    if (!persisted?.desiredOn) continue;
    const nowIso = new Date().toISOString();
    stateRepo.upsert({
      stockId: stock.id,
      desiredOn: false,
      since: null,
      lastCommandAt: persisted.lastCommandAt,
      updatedAt: nowIso,
    });
    console.warn(`Fan control: ${stock.id} is no longer enabled, clearing its stale desired state`);
  }

  // A row that claims fan control but carries no topic prefix is dropped here.
  // Since the API reports availability from the controller map, such a stock
  // would otherwise just be missing its fan control with nothing saying why.
  const wired = new Set(fanStocks.map((s) => s.stockId));
  const skipped = stocks.filter((s) => s.fanControlEnabled && !wired.has(s.id));
  if (skipped.length > 0) {
    console.warn(
      'Fan control: no MQTT topic prefix for ' +
        `${skipped.map((s) => s.id).join(', ')}; ` +
        'these stocks report fan control as unavailable.'
    );
  }

  if (fanStocks.length === 0) {
    console.log('Fan control: no fan-enabled stocks, skipping MQTT init');
    return;
  }
  // Both sections always exist in a real deployment — the configuration builds
  // them with defaults. This guard covers a partial config object (unit tests
  // omit the two so bootstrap opens no socket) and keeps bootstrap from
  // crashing on one.
  if (!config.mqtt || !config.fan) {
    console.warn('Fan control: MQTT/fan configuration missing; skipping fan control.');
    return;
  }
  const mqtt = createMqttService(config.mqtt);

  // Step 1: the automation service first. Its `getController` and
  // `listStocks` are closures resolved at call time, not now — the only
  // reason this and the manager built next can reference each other at all
  // (design spec §5.5).
  const automationService = new AutomationService({
    automationRepo: new AutomationRepository(db),
    stateRepo: new FanStateRepository(db),
    eventsRepo: new FanEventsRepository(db),
    readings: influxService,
    listStocks: () => new StockRepository(getDb()).findAll(),
    getController: (stockId) => getFanManager()?.getController(stockId) ?? null,
    intervalMs: config.fan.automationIntervalMs,
  });

  // Step 2: the manager, with an anonymous callback into the service above —
  // it never learns the service's type (design spec §5.5).
  const manager = new FanControlManager({
    stocks: fanStocks,
    mqtt,
    stateRepo: new FanStateRepository(db),
    eventsRepo: new FanEventsRepository(db),
    timings: {
      keepAliveMs: config.fan.keepAliveMs,
      watchdogMs: config.fan.watchdogMs,
      retentionDays: config.fan.retentionDays,
      retentionSweepMs: config.fan.retentionSweepMs,
      reconcileIntervalMs: config.fan.reconcileIntervalMs,
    },
    fanEnabledStockIds: async () => {
      const current = await new StockRepository(getDb()).findAll();
      return new Set(selectFanStocks(current).map((s) => s.stockId));
    },
    onInterference: (stockId, cause) => automationService.disable(stockId, cause),
    onControlWithdrawn: (stockId) => automationService.disable(stockId, 'fan_control_withdrawn'),
  });

  // Steps 3 to 6, in this order — load-bearing (design spec §5.5, brief §Step 5):
  // `manager.init()` resumes any desired state `recover()` finds before the
  // automation service ever reads it; `setFanManager` makes `getController`
  // resolve real controllers before the service's immediate first evaluation
  // runs, so no stock is silently skipped for a full interval.
  manager.init();
  setFanManager(manager);
  setAutomationService(automationService);
  automationService.start();

  console.log(`Fan control: initialised for ${fanStocks.length} stock(s)`);
}

export function shutdownFanControl(): void {
  const manager = getFanManager();
  if (manager) {
    manager.shutdown();
    setFanManager(null);
  }
  const automationService = getAutomationService();
  if (automationService) {
    automationService.stop();
    setAutomationService(null);
  }
}

export async function validateBootstrap(): Promise<boolean> {
  try {
    const count = await getUserService().countUsers();
    return count > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Bootstrap validation failed:', message);
    return false;
  }
}
