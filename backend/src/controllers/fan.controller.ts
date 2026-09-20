import { Request, Response, NextFunction } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { NotFoundError } from '../middleware';
import { getFanManager } from '../services/fan';
import { getStockService } from '../services';
import { FanController } from '../services/fan';
import type { FanCommandRequest } from '../middleware';
import type { FanStatus } from '../services/fan';

const RECENT_EVENT_LIMIT = 50;

export class FanHttpController {
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      const controller = await this.requireController(stockId);
      res.status(200).json({
        status: controller.getStatus(),
        events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
      });
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
      const controller = await this.requireController(stockId);
      const { action } = req.body;
      controller.command(action);
      res.status(200).json({
        status: controller.getStatus(),
        events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
      });
    } catch (error) {
      next(error);
    }
  }

  async stream(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;

      let unsubscribe = (): void => {};
      let ping: ReturnType<typeof globalThis.setInterval> | undefined;
      let closed = false;

      /** Idempotent teardown. Registered before the first await, so a client
       *  that disconnects while the authorisation read is in flight still tears
       *  the stream down instead of leaking its keep-alive interval. */
      const stop = (endResponse: boolean): void => {
        if (closed) return;
        closed = true;
        if (ping !== undefined) globalThis.clearInterval(ping);
        unsubscribe();
        if (endResponse) {
          // Terminal event so the client knows the stream ended on purpose and
          // does not sit on a stale snapshot waiting for a reconnect.
          res.write('event: disabled\ndata: {}\n\n');
          res.end();
        }
      };
      req.on('close', () => stop(false));

      const controller = await this.requireController(stockId);
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
      unsubscribe = controller.onChange((status) => guarded(() => send(status)));
      ping = globalThis.setInterval(() => guarded(() => res.write(': ping\n\n')), 25000);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Resolves the controller for a stock, or refuses the request.
   *
   * Both the stock row and the controller map must agree. The map alone would
   * keep serving a fan whose row was disabled underneath the running process —
   * controllers are built once at startup — and the row alone would advertise a
   * fan nothing is wired up for. Clearing `fan_control_enabled` therefore stops
   * the stock being served from the next request on; enabling still needs the
   * restart that builds the controller.
   */
  private async requireController(stockId: string): Promise<FanController> {
    const cleared = await this.fanControlCleared(stockId);
    const controller = cleared ? null : getFanManager()?.getController(stockId) ?? null;
    if (!controller) {
      throw new NotFoundError(`Fan control not available for stock: ${stockId}`);
    }
    return controller;
  }

  /**
   * Whether the stock's row no longer asks for fan control — and if so, marks
   * it as retiring.
   *
   * The mark stops the stock being served at once, so no further command can be
   * issued for it. It does not switch the fan off: that is the reconciliation
   * tick's job. Until that tick runs (at most `FAN_RECONCILE_INTERVAL_MS`) the
   * fan may still be running, and the 404 means "not serviceable", not
   * "stopped".
   */
  private async fanControlCleared(stockId: string): Promise<boolean> {
    const stock = await getStockService().getStock(stockId);
    if (stock?.fanControlEnabled) return false;
    // Only mark it: a GET must not publish to MQTT, so the switching is left to
    // the reconciliation tick.
    getFanManager()?.markRetiring(stockId);
    return true;
  }
}
