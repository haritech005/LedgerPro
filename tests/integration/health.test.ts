import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { closeDatabasePool } from '../../src/config/database';

describe('Health and System Endpoints', () => {
  afterAll(async () => {
    await closeDatabasePool();
  });

  describe('GET /api/v1/health', () => {
    it('should return health status with database connectivity details', async () => {
      const response = await request(app).get('/api/v1/health');

      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toHaveProperty('database');
      expect(['connected', 'disconnected']).toContain(response.body.services.database.status);

      if (response.status === 200) {
        expect(response.body.status).toBe('healthy');
        expect(response.body.services.database.status).toBe('connected');
        expect(typeof response.body.services.database.latencyMs).toBe('number');
      } else {
        expect(response.body.status).toBe('unhealthy');
        expect(response.body.services.database.status).toBe('disconnected');
        expect(response.body.services.database).toHaveProperty('error');
      }
    });
  });

  describe('404 Not Found Middleware', () => {
    it('should return standard 404 error format for unknown routes', async () => {
      const response = await request(app).get('/api/v1/unknown-endpoint');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Cannot GET /api/v1/unknown-endpoint',
        },
      });
    });
  });
});
