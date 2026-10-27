import { Request, Response } from 'express';
import { checkDatabaseConnection } from '../config/database';

export async function getHealth(req: Request, res: Response): Promise<void> {
  const dbHealth = await checkDatabaseConnection();

  const isHealthy = dbHealth.status === 'connected';
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbHealth,
    },
  });
}
