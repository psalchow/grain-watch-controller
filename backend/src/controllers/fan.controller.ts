import { Request, Response, NextFunction } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { NotFoundError } from '../middleware';
import { getFanManager } from '../services/fan';
import { FanController } from '../services/fan';
import type { FanCommandRequest } from '../middleware';
import type { FanStatus } from '../services/fan';

const RECENT_EVENT_LIMIT = 50;

export class FanHttpController {
  getStatus(req: Request, res: Response, next: NextFunction): void {
    try {
      const stockId = req.params['stockId'] as string;
      const controller = this.requireController(stockId);
      res.status(200).json({
        status: controller.getStatus(),
        events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
      });
    } catch (error) {
      next(error);
    }
  }

  sendCommand(
    req: Request<ParamsDictionary, unknown, FanCommandRequest>,
    res: Response,
    next: NextFunction
  ): void {
    try {
      const stockId = req.params['stockId'] as string;
      const controller = this.requireController(stockId);
      const { action } = req.body;
      controller.command(action, 'user');
      res.status(200).json({
        status: controller.getStatus(),
        events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
      });
    } catch (error) {
      next(error);
    }
  }

  stream(req: Request, res: Response, next: NextFunction): void {
    try {
      const stockId = req.params['stockId'] as string;
      const controller = this.requireController(stockId);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      const send = (status: FanStatus): void => {
        res.write(`data: ${JSON.stringify({
          status,
          events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
        })}\n\n`);
      };

      // Initial snapshot, then push on every status change (reusing the emitted status).
      send(controller.getStatus());
      const unsubscribe = controller.onChange(send);
      const ping = globalThis.setInterval(() => res.write(': ping\n\n'), 25000);

      req.on('close', () => {
        globalThis.clearInterval(ping);
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  }

  private requireController(stockId: string): FanController {
    const manager = getFanManager();
    const controller = manager?.getController(stockId) ?? null;
    if (!manager || !controller) {
      throw new NotFoundError(`Fan control not available for stock: ${stockId}`);
    }
    return controller;
  }
}
