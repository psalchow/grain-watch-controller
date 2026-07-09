import { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../middleware';
import { getFanManager } from '../services/fan';
import { FanController } from '../services/fan';
import type { FanCommandRequest } from '../middleware';

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

  sendCommand(req: Request, res: Response, next: NextFunction): void {
    try {
      const stockId = req.params['stockId'] as string;
      const controller = this.requireController(stockId);
      const { action } = req.body as FanCommandRequest;
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

      const send = (): void => {
        res.write(`data: ${JSON.stringify({
          status: controller.getStatus(),
          events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
        })}\n\n`);
      };

      send();
      const unsubscribe = controller.onChange(() => send());
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
