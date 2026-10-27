import express, { Application } from 'express';
import apiRouter from './routes';
import { notFoundHandler } from './middleware/not-found';
import { errorHandler } from './middleware/error-handler';

export function createApp(): Application {
  const app: Application = express();

  // Parse incoming JSON payloads
  app.use(express.json());

  // Mount API v1 routes
  app.use('/api/v1', apiRouter);

  // Catch-all 404 handler
  app.use(notFoundHandler);

  // Centralized error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
