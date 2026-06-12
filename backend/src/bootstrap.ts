import { config } from './config';
import { initDb, closeDb } from './db';
import { runMigrations } from './db/migrate';
import { seedStocks } from './db/seed';
import { StockRepository } from './db/repositories';
import { getUserService } from './services';

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
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to bootstrap application:', message);
    closeDb();
    throw new Error(`Bootstrap failed: ${message}`);
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
