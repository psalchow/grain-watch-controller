import { Request, Response, NextFunction } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { NotFoundError } from '../middleware';
import { getFanManager } from '../services/fan';
import { getStockService } from '../services';
import { FanController, automationAvailable } from '../services/fan';
import { getAutomationService } from '../services/automation';
import type { AutomationState } from '../services/automation';
import { getDb } from '../db';
import { AutomationRepository, FanEventsRepository } from '../db/repositories';
import type { FanEvent } from '../db/repositories';
import type { Stock } from '../db/types';
import type { AutomationConfigRequest, FanCommandRequest } from '../middleware';
import type { FanStatus } from '../services/fan';

const RECENT_EVENT_LIMIT = 50;

/**
 * What an open fan page knows about the automation of one stock.
 *
 * `available` is composed here rather than in the service: it needs the stock
 * row, which this layer has already fetched, and the service's snapshot has to
 * stay synchronous (design spec §3.2, §7.1).
 */
export interface AutomationSnapshot extends AutomationState {
  available: boolean;
}

export class FanHttpController {
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      const { controller, stock } = await this.requireController(stockId);
      res.status(200).json(this.snapshot(controller, stock));
    } catch (error) {
      next(error);
    }
  }

  async sendCommand(
    req: Request<ParamsDictionary, unknown, FanCommandRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      const { controller, stock } = await this.requireController(stockId);
      const { action } = req.body;
      // Unconditional: a manual command takes the fan over from automation
      // regardless of whether it was already off, and the service — not this
      // controller — decides whether that is a no-op (design spec §5.5).
      getAutomationService()?.disable(stockId, 'manual_command');
      controller.command(action);
      // Same shape as the GET, so the response reports the automation this
      // command has just switched off rather than leaving the page on a stale
      // "Automatik aktiv".
      res.status(200).json(this.snapshot(controller, stock));
    } catch (error) {
      next(error);
    }
  }

  /**
   * The stored configuration, or the defaults while no row exists (design spec §7).
   */
  async getAutomation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      await this.requireAutomatableStock(stockId);
      res.status(200).json(new AutomationRepository(getDb()).get(stockId));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Stores the switch and the seven parameters in one call, and fires the
   * follow-up the direction of the switch calls for.
   *
   * No role check beyond stock access, matching the switch command next to it.
   * That the `viewer` role can write is a known, recorded contradiction; the
   * backlog carries the fix (design spec §7).
   */
  async putAutomation(
    req: Request<ParamsDictionary, unknown, AutomationConfigRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      await this.requireAutomatableStock(stockId);

      const repo = new AutomationRepository(getDb());
      const before = repo.get(stockId);
      const after = req.body;
      repo.upsert(stockId, after);
      new FanEventsRepository(getDb()).insert({
        stockId,
        ts: new Date().toISOString(),
        kind: 'automation_configured',
        payload: { before, after },
        source: 'user',
      });
      const stored = repo.get(stockId);

      const service = getAutomationService();
      if (!before.enabled && after.enabled) {
        // Awaited: without it the stock is enabled but undecided for up to five
        // minutes, and the user who just switched automation on gets no answer
        // to the only question they have — will it run (design spec §5.2).
        // `evaluateStock` never rejects, so the request cannot fail on it.
        await service?.evaluateStock(stockId);
      } else if (before.enabled && !after.enabled) {
        // A disabled stock is never evaluated again, so nothing else would ever
        // carry the news to a second open page (design spec §7.1).
        service?.notifyChanged(stockId);
      }

      res.status(200).json(stored);
    } catch (error) {
      next(error);
    }
  }

  async stream(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;

      let unsubscribeStatus = (): void => {};
      let unsubscribeAutomation = (): void => {};
      let ping: ReturnType<typeof globalThis.setInterval> | undefined;
      let closed = false;

      /** Idempotent teardown. Registered before the first await, so a client
       *  that disconnects while the authorisation read is in flight still tears
       *  the stream down instead of leaking its keep-alive interval. */
      const stop = (endResponse: boolean): void => {
        if (closed) return;
        closed = true;
        if (ping !== undefined) globalThis.clearInterval(ping);
        unsubscribeStatus();
        unsubscribeAutomation();
        if (endResponse) {
          // Terminal event so the client knows the stream ended on purpose and
          // does not sit on a stale snapshot waiting for a reconnect.
          res.write('event: disabled\ndata: {}\n\n');
          res.end();
        }
      };
      req.on('close', () => stop(false));

      const { controller, stock } = await this.requireController(stockId);
      if (closed) return;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // nginx buffers proxied responses by default, which stalls the stream
        // behind a reverse proxy. Ignored by everything else.
        'X-Accel-Buffering': 'no',
      });

      const send = (status: FanStatus): void => {
        res.write(`data: ${JSON.stringify({
          status,
          events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
          automation: this.automationSnapshot(stock),
        })}\n\n`);
      };

      /**
       * Writes only while the stock is still serviceable. The check is a
       * synchronous lookup in the controller map, which the reconciliation tick
       * keeps current — no database read per push, so emit order is preserved
       * and a transient read error cannot be mistaken for a revocation.
       *
       * The user's stock access is *not* re-checked: `requireStockAccess` runs
       * once at connect, so revoking a grant takes effect on reconnect.
       */
      const guarded = (write: () => void): void => {
        if (closed) return;
        if (getFanManager()?.getController(stockId) == null) return stop(true);
        write();
      };

      // Initial snapshot, then push on every status change (reusing the emitted status).
      send(controller.getStatus());
      unsubscribeStatus = controller.onChange((status) => guarded(() => send(status)));
      // The second source: `FanController.onChange` fires on fan state changes
      // only, so a changing reason without a switch — `hold` → `humidity_high`,
      // the most common case there is — would leave a stale reason on the card.
      // It fires after every evaluation, not only on a changed reason:
      // `evaluatedAt` is what tells the user the automation is alive (§7.1).
      unsubscribeAutomation =
        getAutomationService()?.onChange(stockId, () =>
          guarded(() => send(controller.getStatus()))
        ) ?? ((): void => {});
      ping = globalThis.setInterval(() => guarded(() => res.write(': ping\n\n')), 25000);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Resolves the controller and the row for a stock, or refuses the request.
   *
   * Both the stock row and the controller map must agree. The map alone would
   * keep serving a fan whose row was disabled underneath the running process —
   * controllers are built once at startup — and the row alone would advertise a
   * fan nothing is wired up for. Clearing `fan_control_enabled` therefore stops
   * the stock being served from the next request on; enabling still needs the
   * restart that builds the controller.
   *
   * The row travels back with the controller because `available` is composed
   * from it (design spec §3.2) — one read serves both.
   */
  private async requireController(
    stockId: string
  ): Promise<{ controller: FanController; stock: Stock }> {
    const stock = await getStockService().getStock(stockId);
    if (!stock?.fanControlEnabled) {
      // The stock's row no longer asks for fan control: mark it as retiring so
      // no further command can be issued for it. Only mark it — a GET must not
      // publish to MQTT, so the switching off is left to the reconciliation
      // tick. Until that tick runs (at most `FAN_RECONCILE_INTERVAL_MS`) the fan
      // may still be running, and the 404 means "not serviceable", not
      // "stopped".
      getFanManager()?.markRetiring(stockId);
      throw new NotFoundError(`Fan control not available for stock: ${stockId}`);
    }
    const controller = getFanManager()?.getController(stockId) ?? null;
    if (!controller) {
      throw new NotFoundError(`Fan control not available for stock: ${stockId}`);
    }
    return { controller, stock };
  }

  /**
   * Resolves a stock that can have automation, or refuses the request.
   *
   * Two ways to fail, one answer: no fan control, and no grain thermometers.
   * v1 implements the differential rule only, so without thermometers the
   * automation could never switch on — the parameters would be a form with no
   * effect (design spec §3.2).
   *
   * `requireController` first, for its 404 and its retirement mark on the fan
   * half; `automationAvailable` then restates the whole predicate rather than
   * only the thermometer half, so the refusal here and the `available` the
   * snapshot reports can never mean different things.
   */
  private async requireAutomatableStock(stockId: string): Promise<Stock> {
    const { stock } = await this.requireController(stockId);
    if (!automationAvailable(stock)) {
      throw new NotFoundError(`Automation not available for stock: ${stockId}`);
    }
    return stock;
  }

  /** The wire shape of `GET …/fan`, the command response and every SSE frame. */
  private snapshot(
    controller: FanController,
    stock: Stock
  ): { status: FanStatus; events: FanEvent[]; automation: AutomationSnapshot } {
    return {
      status: controller.getStatus(),
      events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
      automation: this.automationSnapshot(stock),
    };
  }

  /**
   * The service's state plus `available`.
   *
   * Without a running service the configuration is still what the database
   * says, so `enabled` comes from the row rather than from a hard-coded false —
   * the same answer `GET …/fan/automation` gives. `reason` and `evaluatedAt`
   * stay null: nothing has evaluated anything.
   */
  private automationSnapshot(stock: Stock): AutomationSnapshot {
    const state = getAutomationService()?.getState(stock.id) ?? {
      enabled: new AutomationRepository(getDb()).get(stock.id).enabled,
      reason: null,
      evaluatedAt: null,
    };
    return { ...state, available: automationAvailable(stock) };
  }
}
