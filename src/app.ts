import express, { Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

export function createApp(): Express {
  const app = express();

  // Security middleware
  app.use(helmet());

  // Request logging (skip in test environment)
  if (process.env['NODE_ENV'] !== 'test') {
    app.use(morgan('combined'));
  }

  // Body parsing
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  return app;
}
