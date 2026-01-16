/**
 * Stock routes for the grainwatch-controller BFF.
 *
 * Provides endpoints for querying grain stock data including
 * latest readings, time-series temperature/humidity data,
 * summaries, and battery status.
 *
 * All endpoints require authentication and stock-level authorisation.
 */

import { Router } from 'express';
import { StocksController } from '../controllers';
import { influxService } from '../services';
import {
  authenticate,
  requireStockAccess,
  validateParams,
  validateQuery,
  stockIdParamsSchema,
  stockQuerySchema,
} from '../middleware';
import { z } from 'zod';

/**
 * Summary query parameters schema.
 */
const summaryQuerySchema = z.object({
  /** Time period for summary (default: '24h') */
  period: z.enum(['24h', '7d', '30d']).optional(),
  /** Temperature layer filter */
  layer: z.enum(['top', 'mid', 'bottom']).optional(),
});

/**
 * Creates the stocks router with all stock-related endpoints.
 *
 * @returns Configured Express router for stock endpoints
 */
export function createStocksRouter(): Router {
  const router = Router();
  const controller = new StocksController(influxService);

  /**
   * GET /
   *
   * List all grain stocks accessible to the authenticated user.
   *
   * Response (200):
   * - stocks: Array of stock objects
   * - total: Total number of accessible stocks
   */
  router.get(
    '/',
    authenticate,
    (req, res, next) => controller.listStocks(req, res, next)
  );

  /**
   * GET /:stockId/latest
   *
   * Get the most recent readings for all devices in a grain stock.
   *
   * Parameters:
   * - stockId: Grain stock identifier
   *
   * Response (200):
   * - stockId: Stock identifier
   * - stockName: Stock display name
   * - timestamp: Latest reading timestamp
   * - devices: Array of device readings
   *
   * Errors:
   * - 400: Invalid stockId parameter
   * - 403: User not authorised to access this stock
   * - 404: Stock not found or no readings
   */
  router.get(
    '/:stockId/latest',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.getLatestReadings(req, res, next)
  );

  /**
   * GET /:stockId/temperature
   *
   * Get temperature time-series data for a stock.
   *
   * Parameters:
   * - stockId: Grain stock identifier
   *
   * Query parameters:
   * - start (required): ISO 8601 timestamp
   * - end (required): ISO 8601 timestamp
   * - layer (optional): 'top', 'mid', or 'bottom'
   * - device (optional): Specific device ID
   * - window (optional): Aggregation window (default: '15m')
   *
   * Response (200):
   * - data: Array of time-series data points
   * - meta: Query metadata
   *
   * Errors:
   * - 400: Invalid parameters
   * - 403: User not authorised to access this stock
   */
  router.get(
    '/:stockId/temperature',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    validateQuery(stockQuerySchema),
    (req, res, next) => controller.getTemperatureData(req, res, next)
  );

  /**
   * GET /:stockId/humidity
   *
   * Get humidity time-series data for a stock.
   *
   * Parameters:
   * - stockId: Grain stock identifier
   *
   * Query parameters:
   * - start (required): ISO 8601 timestamp
   * - end (required): ISO 8601 timestamp
   * - device (optional): Specific device ID
   * - window (optional): Aggregation window (default: '15m')
   *
   * Response (200):
   * - data: Array of time-series data points
   * - meta: Query metadata
   *
   * Errors:
   * - 400: Invalid parameters
   * - 403: User not authorised to access this stock
   */
  router.get(
    '/:stockId/humidity',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    validateQuery(stockQuerySchema),
    (req, res, next) => controller.getHumidityData(req, res, next)
  );

  /**
   * GET /:stockId/summary
   *
   * Get aggregated statistics for a stock over a time period.
   *
   * Parameters:
   * - stockId: Grain stock identifier
   *
   * Query parameters:
   * - period (optional): '24h', '7d', or '30d' (default: '24h')
   * - layer (optional): 'top', 'mid', or 'bottom'
   *
   * Response (200):
   * - stockId: Stock identifier
   * - stockName: Stock display name
   * - period: Time period
   * - summary: Temperature and humidity statistics
   * - deviceStatus: Array of device status objects
   *
   * Errors:
   * - 400: Invalid parameters
   * - 403: User not authorised to access this stock
   */
  router.get(
    '/:stockId/summary',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    validateQuery(summaryQuerySchema),
    (req, res, next) => controller.getSummary(req, res, next)
  );

  /**
   * GET /:stockId/battery
   *
   * Get battery status for all devices in a stock.
   *
   * Parameters:
   * - stockId: Grain stock identifier
   *
   * Response (200):
   * - stockId: Stock identifier
   * - stockName: Stock display name
   * - devices: Array of device battery status objects
   * - alerts: Array of battery alerts (low/critical)
   *
   * Errors:
   * - 400: Invalid stockId parameter
   * - 403: User not authorised to access this stock
   */
  router.get(
    '/:stockId/battery',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.getBatteryData(req, res, next)
  );

  return router;
}

/**
 * Pre-configured stocks router instance.
 */
export const stocksRouter = createStocksRouter();
