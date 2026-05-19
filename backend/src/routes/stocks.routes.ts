import { Router } from 'express';
import { StocksController } from '../controllers';
import { influxService } from '../services';
import {
  authenticate,
  requireStockAccess,
  validateParams,
  validateQuery,
  stockIdParamsSchema,
  historyQuerySchema,
} from '../middleware';

export function createStocksRouter(): Router {
  const router = Router();
  const controller = new StocksController(influxService);

  router.get(
    '/',
    authenticate,
    (req, res, next) => controller.listStocks(req, res, next)
  );

  router.get(
    '/:stockId/latest',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.getLatestReadings(req, res, next)
  );

  router.get(
    '/:stockId/history',
    authenticate,
    validateParams(stockIdParamsSchema),
    validateQuery(historyQuerySchema),
    requireStockAccess,
    (req, res, next) => controller.getHistory(req, res, next)
  );

  return router;
}

export const stocksRouter = createStocksRouter();
