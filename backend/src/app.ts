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
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
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
 * Resolves the directory holding the built PWA, when present.
 *
 * The backend serves the frontend as static files only when a build has been
 * bundled alongside it (i.e. in the production Docker image). When the directory
 * is absent — as in local development and tests — the service runs API-only and
 * this returns null.
 *
 * @returns Absolute path to the frontend dist directory, or null when unavailable
 */
function resolveFrontendDistPath(): string | null {
  const distPath = process.env['FRONTEND_DIST_PATH'] ?? '/app/public';
  return fs.existsSync(path.join(distPath, 'index.html')) ? distPath : null;
}

/**
 * Resolves the application version from the workspace root manifest.
 *
 * The root manifest is the single source of truth for the version: the PWA and
 * the BFF ship as one Docker image, so one version describes the whole release.
 * The workspace manifests carry no version of their own.
 *
 * The compiled application runs as `node dist/index.js` rather than through an
 * npm script, so `npm_package_version` is unset in production. Reading the
 * manifest keeps the reported version correct in every execution mode and
 * removes the need for a hard-coded fallback that silently goes stale.
 *
 * `__dirname` is `backend/src` when running from source and `backend/dist` when
 * compiled, so the root manifest sits two levels above in both cases.
 *
 * @returns The version string, or 'unknown' if the manifest cannot be read
 */
function resolveVersion(): string {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as { version?: string };
    return manifest.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Application version, resolved once at module load. */
const APP_VERSION = resolveVersion();

/**
 * Builds the Helmet configuration.
 *
 * When the PWA is served from this origin we relax the Content-Security-Policy
 * so the bundled assets and the vite-plugin-pwa service-worker registration can
 * load. Otherwise Helmet's stricter defaults apply.
 *
 * @param serveFrontend - Whether the PWA is served from this origin
 * @returns Helmet middleware
 */
function createHelmet(serveFrontend: boolean) {
  if (!serveFrontend) {
    return helmet();
  }

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' covers the vite-plugin-pwa service-worker registration
        // snippet; tighten to hashes later if required.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
      },
    },
  });
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

  // Serve the bundled PWA only when a build is present (production image).
  const frontendDistPath = resolveFrontendDistPath();

  // ==========================================================================
  // Security Middleware
  // ==========================================================================

  // Set security HTTP headers (CSP relaxed when serving the PWA from this origin)
  app.use(createHelmet(frontendDistPath !== null));

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

  // Parse cookies (required for the httpOnly refresh-token cookie)
  app.use(cookieParser());

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
      version: APP_VERSION,
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

  // ==========================================================================
  // Static Frontend (PWA)
  // ==========================================================================

  /**
   * Serve the bundled PWA and provide an SPA fallback.
   *
   * Static assets are served with content-hashed filenames. Any remaining GET
   * request that is not an API call or the health probe returns index.html so
   * client-side routing works on deep links and page reloads. API 404s still
   * fall through to notFoundHandler rather than being masked by index.html.
   */
  if (frontendDistPath) {
    app.use(express.static(frontendDistPath, { index: false }));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/health') {
        return next();
      }
      res.sendFile(path.join(frontendDistPath, 'index.html'));
    });
  }

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
