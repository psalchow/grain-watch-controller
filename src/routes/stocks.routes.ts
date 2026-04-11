import { Router } from 'express';
import { StocksController } from '../controllers';
import { influxService } from '../services';
import {
  authenticate,
  requireStockAccess,
  validateParams,
  stockIdParamsSchema,
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

  return router;
}

export const stocksRouter = createStocksRouter();
