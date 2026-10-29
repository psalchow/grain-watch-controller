import type { StockRepository } from '../../db/repositories';
import { DEFAULT_TENANT_ID } from '../../db/schema';
import type { Stock, StockPatch } from '../../db/types';
import { getFanManager } from '../fan';

export class StockServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'conflict' | 'invalid'
  ) {
    super(message);
    this.name = 'StockServiceError';
  }
}

/** What a caller supplies to create a stock. Id, creation time and tenant are the service's. */
export type CreateStockInput = Omit<Stock, 'id' | 'createdAt' | 'tenantId'>;

/**
 * Fire-and-forget: the HTTP answer does not wait for the fan wiring. A failure
 * is logged here because nothing awaits the promise and the process installs
 * no `unhandledRejection` handler.
 */
function reconcileFanControl(): void {
  void getFanManager()
    ?.reconcile()
    .catch((error: unknown) => {
      console.error('Fan control: reconciliation after a stock change failed', error);
    });
}

const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

export class StockService {
  constructor(private readonly repo: StockRepository) {}

  async listStocks(): Promise<Stock[]> {
    return this.repo.findAll();
  }

  async getStock(id: string): Promise<Stock | null> {
    return this.repo.findById(id);
  }

  async createStock(input: CreateStockInput): Promise<Stock> {
    const stock = normalise({
      ...input,
      id: await this.generateStockId(),
      createdAt: new Date().toISOString(),
      tenantId: DEFAULT_TENANT_ID,
    });
    await this.assertInvariants(stock);
    try {
      await this.repo.create(stock);
    } catch (error) {
      // The id is generated from a scan, so a collision means another writer
      // took it between scan and insert. Report it as a conflict, not a raw
      // SQLite error; the caller may simply retry.
      if (isPrimaryKeyViolation(error)) {
        throw new StockServiceError(`Stock id ${stock.id} is already taken`, 'conflict');
      }
      throw error;
    }
    reconcileFanControl();
    return stock;
  }

  async updateStock(id: string, patch: StockPatch): Promise<Stock> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new StockServiceError(`Stock ${id} not found`, 'not_found');

    const merged = normalise(applyPatch(existing, patch));
    await this.assertInvariants(merged);

    if (!(await this.repo.update(id, effectivePatch(patch, merged)))) {
      throw new StockServiceError(`Stock ${id} not found`, 'not_found');
    }
    reconcileFanControl();
    return merged;
  }

  async deleteStock(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new StockServiceError(`Stock ${id} not found`, 'not_found');
    if (existing.active) {
      throw new StockServiceError(`Stock ${id} is active; deactivate it before deleting`, 'conflict');
    }

    // Publishes the final `off` and drops the wiring while the row still
    // exists; the cascade removes the stand_down row it writes.
    getFanManager()?.retireController(id);

    if (!(await this.repo.delete(id))) {
      throw new StockServiceError(`Stock ${id} not found`, 'not_found');
    }
  }

  private async assertInvariants(stock: Stock): Promise<void> {
    if (stock.fanControlEnabled && isBlank(stock.fanTopicPrefix)) {
      throw new StockServiceError('Fan control requires a fan topic prefix', 'invalid');
    }
    if (stock.hasGrainSensors && isBlank(stock.deviceGroup)) {
      throw new StockServiceError('Grain thermometers require a device group', 'invalid');
    }
    await this.assertTopicPrefixIsFree(stock);
  }

  /**
   * A topic prefix addresses one fan controller, so two stocks may not share
   * one: commands published under it switch whichever controller listens, and
   * `FanControlManager.route` hands an incoming message to the first matching
   * wiring only — the second stock is then switched blind, without status or
   * monitor. Copying a prefix from a neighbouring stock is the obvious mistake
   * the form invites, so it is refused rather than tolerated.
   *
   * Compared verbatim across all tenants: MQTT topics are global and
   * case-sensitive, so two prefixes differing in case are two controllers.
   * A stock without fan control carries no prefix (`normalise`) and is
   * therefore neither a subject nor a candidate here.
   */
  private async assertTopicPrefixIsFree(stock: Stock): Promise<void> {
    const prefix = stock.fanTopicPrefix;
    if (prefix === undefined) return;

    const clash = (await this.repo.findAll()).find(
      (other) => other.id !== stock.id && other.fanTopicPrefix === prefix
    );
    if (clash) {
      throw new StockServiceError(
        `Fan topic prefix is already used by stock ${clash.id}`,
        'conflict'
      );
    }
  }

  /** Generates the next id in the format 'stk_XXX'; ids of any other shape are ignored. */
  private async generateStockId(): Promise<string> {
    const existing = await this.repo.findAll();
    const numbers = existing
      .map((s) => s.id.match(/^stk_(\d+)$/)?.[1])
      .filter((n): n is string => n !== undefined)
      .map((n) => parseInt(n, 10));
    const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
    return `stk_${String(next).padStart(3, '0')}`;
  }
}

/**
 * A switch that is off governs its dependent fields: they are written as their
 * defaults whatever was supplied. Discarded silently; the browser form submits
 * disabled fields on purpose. `outdoorDevice` belongs to the fan controller
 * and is not governed by either switch.
 */
function normalise(stock: Stock): Stock {
  const result: Stock = { ...stock };
  if (!result.hasGrainSensors) {
    delete result.deviceGroup;
    result.hasHumidity = false;
  }
  if (!result.fanControlEnabled) {
    delete result.fanTopicPrefix;
    result.fanSwitchId = 0;
  }
  return result;
}

/**
 * What the repository is told: the caller's patch with the suppressed fields
 * replaced by explicit resets, so a stored value is cleared even when the
 * patch never mentioned it.
 */
function effectivePatch(patch: StockPatch, normalised: Stock): StockPatch {
  const effective: StockPatch = { ...patch };
  if (!normalised.hasGrainSensors) {
    effective.deviceGroup = null;
    effective.hasHumidity = false;
  }
  if (!normalised.fanControlEnabled) {
    effective.fanTopicPrefix = null;
    effective.fanSwitchId = 0;
  }
  return effective;
}

/** The stock as it will look once `patch` is applied: `null` clears an optional field. */
function applyPatch(stock: Stock, patch: StockPatch): Stock {
  const merged: Stock = { ...stock };
  if (patch.name !== undefined) merged.name = patch.name;
  if (patch.hasHumidity !== undefined) merged.hasHumidity = patch.hasHumidity;
  if (patch.hasGrainSensors !== undefined) merged.hasGrainSensors = patch.hasGrainSensors;
  if (patch.active !== undefined) merged.active = patch.active;
  if (patch.fanControlEnabled !== undefined) merged.fanControlEnabled = patch.fanControlEnabled;
  if (patch.fanSwitchId !== undefined) merged.fanSwitchId = patch.fanSwitchId;

  const nullable = ['description', 'deviceGroup', 'outdoorDevice', 'fanTopicPrefix'] as const;
  for (const key of nullable) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

function isPrimaryKeyViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE';
}
