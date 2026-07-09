import { eq, desc, lt } from 'drizzle-orm';
import type { Db } from '../types';
import { fanState, fanEvents } from '../schema';
import type { DbFanState } from '../schema';

export interface FanEvent {
  id: number;
  stockId: string;
  ts: string;
  kind: string;
  payload: unknown;
  source: string;
}

export interface FanStateUpsert {
  stockId: string;
  desiredOn: boolean;
  since: string | null;
  lastCommandAt: string | null;
  updatedAt: string;
}

export class FanStateRepository {
  constructor(private readonly db: Db) {}

  get(stockId: string): DbFanState | null {
    return (
      this.db.select().from(fanState).where(eq(fanState.stockId, stockId)).get() ?? null
    );
  }

  upsert(row: FanStateUpsert): void {
    this.db
      .insert(fanState)
      .values(row)
      .onConflictDoUpdate({
        target: fanState.stockId,
        set: {
          desiredOn: row.desiredOn,
          since: row.since,
          lastCommandAt: row.lastCommandAt,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }
}

export interface FanEventInsert {
  stockId: string;
  ts: string;
  kind: string;
  payload: unknown;
  source: string;
}

export class FanEventsRepository {
  constructor(private readonly db: Db) {}

  insert(row: FanEventInsert): void {
    this.db
      .insert(fanEvents)
      .values({
        stockId: row.stockId,
        ts: row.ts,
        kind: row.kind,
        payload: row.payload === undefined ? null : JSON.stringify(row.payload),
        source: row.source,
      })
      .run();
  }

  listRecent(stockId: string, limit: number): FanEvent[] {
    const rows = this.db
      .select()
      .from(fanEvents)
      .where(eq(fanEvents.stockId, stockId))
      .orderBy(desc(fanEvents.ts), desc(fanEvents.id))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      id: r.id,
      stockId: r.stockId,
      ts: r.ts,
      kind: r.kind,
      payload: r.payload !== null ? JSON.parse(r.payload) : null,
      source: r.source,
    }));
  }

  deleteOlderThan(cutoffIso: string): number {
    const result = this.db
      .delete(fanEvents)
      .where(lt(fanEvents.ts, cutoffIso))
      .run();
    return result.changes;
  }
}
