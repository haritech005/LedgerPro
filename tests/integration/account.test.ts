import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { closeDatabasePool } from '../../src/config/database';

describe('Account Creation Endpoints (Phase 2)', () => {
  afterAll(async () => {
    await closeDatabasePool();
  });

  describe('POST /api/v1/accounts', () => {
    it('should create an account with valid name and guaranteed zero balance', async () => {
      const payload = { name: 'Alice Walker' };

      const response = await request(app)
        .post('/api/v1/accounts')
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Alice Walker');
      expect(response.body.balance).toBe('0.00');
      expect(response.body).toHaveProperty('created_at');

      // Verify UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(response.body.id).toMatch(uuidRegex);

      // Verify valid ISO timestamp
      expect(new Date(response.body.created_at).toISOString()).toBe(response.body.created_at);
    });

    it('should trim whitespace around valid account name', async () => {
      const payload = { name: '   Bob Ross   ' };

      const response = await request(app)
        .post('/api/v1/accounts')
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('Bob Ross');
      expect(response.body.balance).toBe('0.00');
    });

    it('should reject request when name is missing', async () => {
      const response = await request(app)
        .post('/api/v1/accounts')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/name is required/i);
    });

    it('should reject request when name is empty string or only whitespace', async () => {
      const response = await request(app)
        .post('/api/v1/accounts')
        .send({ name: '     ' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/cannot be empty or whitespace/i);
    });

    it('should reject client-supplied initial balance', async () => {
      const response = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Charlie', balance: 500.0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/initial balance cannot be provided/i);
    });

    it('should reject client-supplied account id', async () => {
      const response = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Charlie', id: '12345' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/system-generated/i);
    });

    it('should reject client-supplied created_at timestamp', async () => {
      const response = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Charlie', created_at: '2020-01-01T00:00:00Z' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/system-generated/i);
    });

    it('should reject unrecognized extra fields', async () => {
      const response = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Charlie', role: 'admin' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
