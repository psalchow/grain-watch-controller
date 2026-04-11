/**
 * Express application factory for the grainwatch-controller BFF.
 *
 * Creates and configures the Express application with all necessary
 * middleware including security headers, CORS, request logging,
 * body parsing, and error handling.
 */

import express, { Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import { errorHandler, notFoundHandler } from './middleware';
import { createApiRouter } from './routes';

/**
 * CORS configuration options.
 */
interface CorsOptions {
  /** Allowed origins (defaults to all in development) */
  origin?: string | string[] | boolean;

  /** Allowed HTTP methods */
  methods?: string[];

  /** Allowed request headers */
  allowedHeaders?: string[];

  /** Whether to allow credentials */
  credentials?: boolean;
}

/**
 * Application factory options.
 */
interface CreateAppOptions {
  /** Custom CORS configuration */
  cors?: CorsOptions;

  /** Whether to enable request logging (defaults to true except in test) */
  enableLogging?: boolean;

  /** Morgan log format (defaults to 'combined') */
  logFormat?: string;
}

/**
 * Gets default CORS options based on environment.
 *
 * @returns CORS configuration object
 */
function getDefaultCorsOptions(): CorsOptions {
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction) {
    // In production, restrict to specific origins via environment variable
    const allowedOrigins = process.env['CORS_ALLOWED_ORIGINS'];

    return {
      origin: allowedOrigins ? allowedOrigins.split(',').map((o) => o.trim()) : false,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    };
  }

  // In development, allow all origins
  return {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  };
}

/**
 * Creates and configures the Express application.
 *
 * The application is configured with the following middleware (in order):
 * 1. Security headers (Helmet)
 * 2. CORS support
 * 3. Request logging (Morgan) - except in test environment
 * 4. JSON body parsing
 * 5. Health check endpoint
 * 6. API routes (/api/v1/*)
 *
 * Note: Error handlers (404 and centralised) should be added by calling
 * finaliseApp() after createApp(), or use createFullApp() for a complete
 * application with all handlers.
 *
 * @param options - Optional configuration options
 * @returns Configured Express application (without error handlers)
 *
 * @example
 * // Basic usage with finalisation
 * const app = createApp();
 * finaliseApp(app);
 * app.listen(3000);
 *
 * // With custom CORS configuration
 * const app = createApp({
 *   cors: {
 *     origin: 'https://example.com',
 *     credentials: true,
 *   },
 * });
 * finaliseApp(app);
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // ==========================================================================
  // Security Middleware
  // ==========================================================================

  // Set security HTTP headers
  app.use(helmet());

  // Configure CORS
  const corsOptions = options.cors ?? getDefaultCorsOptions();
  app.use(cors(corsOptions));

  // ==========================================================================
  // Request Processing Middleware
  // ==========================================================================

  // Request logging (skip in test environment unless explicitly enabled)
  const shouldLog =
    options.enableLogging ?? process.env['NODE_ENV'] !== 'test';

  if (shouldLog) {
    const logFormat = options.logFormat ?? 'combined';
    app.use(morgan(logFormat));
  }

  // Parse JSON request bodies
  app.use(express.json({ limit: '1mb' }));

  // Parse URL-encoded request bodies
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ==========================================================================
  // Health Check Endpoint
  // ==========================================================================

  /**
   * Health check endpoint for monitoring and load balancer probes.
   * Returns a simple JSON response indicating the service is healthy.
   */
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env['npm_package_version'] ?? '0.1.0',
    });
  });

  // ==========================================================================
  // API Routes
  // ==========================================================================

  /**
   * Mount API routes under /api/v1 prefix.
   *
   * Route structure:
   * - /api/v1/auth/* - Authentication endpoints (login, token refresh)
   * - /api/v1/stocks/* - Stock data query endpoints
   * - /api/v1/admin/* - Admin user management endpoints
   */
  app.use('/api/v1', createApiRouter());

  return app;
}

/**
 * Finalises the Express application by adding error handling middleware.
 *
 * This function should be called after all routes have been registered.
 * It adds the 404 handler and centralised error handler as the last
 * middleware in the chain.
 *
 * @param app - Express application to finalise
 * @returns The same Express application with error handlers added
 *
 * @example
 * const app = createApp();
 *
 * // Add your routes
 * app.use('/api/stocks', stocksRouter);
 * app.use('/api/auth', authRouter);
 *
 * // Finalise the app with error handlers
 * finaliseApp(app);
 *
 * // Start the server
 * app.listen(3000);
 */
export function finaliseApp(app: Express): Express {
  // Handle 404 for unmatched routes
  app.use(notFoundHandler);

  // Centralised error handling (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Creates a fully configured Express application with error handlers.
 *
 * This is a convenience function that calls createApp() and finaliseApp().
 * Use this when you don't need to add any custom routes.
 *
 * @param options - Optional configuration options
 * @returns Fully configured Express application
 *
 * @example
 * const app = createFullApp();
 * app.listen(3000);
 */
export function createFullApp(options: CreateAppOptions = {}): Express {
  const app = createApp(options);
  return finaliseApp(app);
}
