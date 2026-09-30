import { Router } from 'express';
import { FanHttpController } from '../controllers';
import {
  authenticate,
  requireStockAccess,
  validateParams,
  validateBody,
  stockIdParamsSchema,
  fanCommandSchema,
  automationConfigSchema,
} from '../middleware';

export function createFanRouter(): Router {
  const router = Router();
  const controller = new FanHttpController();

  router.get(
    '/:stockId/fan',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.getStatus(req, res, next)
  );

  router.post(
    '/:stockId/fan/command',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    validateBody(fanCommandSchema),
    (req, res, next) => controller.sendCommand(req, res, next)
  );

  router.get(
    '/:stockId/fan/automation',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.getAutomation(req, res, next)
  );

  router.put(
    '/:stockId/fan/automation',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    validateBody(automationConfigSchema),
    (req, res, next) => controller.putAutomation(req, res, next)
  );

  router.get(
    '/:stockId/fan/stream',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.stream(req, res, next)
  );

  return router;
}
