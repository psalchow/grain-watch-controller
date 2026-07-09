import { config } from './config';
import { initDb, closeDb, getDb } from './db';
import { runMigrations } from './db/migrate';
import { seedStocks } from './db/seed';
import { StockRepository, FanStateRepository, FanEventsRepository } from './db/repositories';
import { getUserService } from './services';
import { createMqttService } from './services/mqtt';
import { FanControlManager, selectFanStocks, setFanManager, getFanManager } from './services/fan';

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
  if (fanStocks.length === 0) {
    console.log('Fan control: no fan-enabled stocks, skipping MQTT init');
    return;
  }
  // config.mqtt / config.fan may be absent in test environments that mock config minimally
  if (!config.mqtt || !config.fan) {
    console.log('Fan control: MQTT/fan config not available, skipping MQTT init');
    return;
  }
  const mqtt = createMqttService(config.mqtt);
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
    },
  });
  manager.init();
  setFanManager(manager);
  console.log(`Fan control: initialised for ${fanStocks.length} stock(s)`);
}

export function shutdownFanControl(): void {
  const manager = getFanManager();
  if (manager) {
    manager.shutdown();
    setFanManager(null);
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
