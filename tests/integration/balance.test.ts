import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { closeDatabasePool } from '../../src/config/database';
import { cleanupTestAccounts } from '../helpers/db-cleanup';

describe('Account Balance API (Phase 5)', () => {
  let testAccountId: string;

  beforeAll(async () => {
    const acc = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Balance Test Account' });
    testAccountId = acc.body.id;
  });

  afterAll(async () => {
    await cleanupTestAccounts([testAccountId]);
    await closeDatabasePool();
  });

  describe('GET /api/v1/accounts/:accountId/balance', () => {
    it('should retrieve 0.00 balance for a newly created account', async () => {
      const response = await request(app).get(
        `/api/v1/accounts/${testAccountId}/balance`
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        account_id: testAccountId,
        balance: '0.00',
      });
    });

    it('should retrieve accurate updated balance after a credit transaction', async () => {
      // Credit 500.00
      const txRes = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: 500.0,
          description: 'Balance test credit',
          reference_id: 'BAL-CRED-01',
        });
      expect(txRes.status).toBe(201);

      // Verify balance endpoint returns 500.00
      const response = await request(app).get(
        `/api/v1/accounts/${testAccountId}/balance`
      );

      expect(response.status).toBe(200);
      expect(response.body.account_id).toBe(testAccountId);
      expect(response.body.balance).toBe('500.00');
    });

    it('should retrieve accurate updated balance after a debit transaction', async () => {
      // Debit 150.00
      const txRes = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'debit',
          amount: 150.0,
          description: 'Balance test debit',
          reference_id: 'BAL-DEB-01',
        });
      expect(txRes.status).toBe(201);

      // Verify balance endpoint returns 350.00 (500 - 150)
      const response = await request(app).get(
        `/api/v1/accounts/${testAccountId}/balance`
      );

      expect(response.status).toBe(200);
      expect(response.body.account_id).toBe(testAccountId);
      expect(response.body.balance).toBe('350.00');
    });

    it('should preserve documented 2-decimal precision', async () => {
      const response = await request(app).get(
        `/api/v1/accounts/${testAccountId}/balance`
      );

      expect(response.status).toBe(200);
      expect(typeof response.body.balance).toBe('string');
      expect(response.body.balance).toMatch(/^\d+\.\d{2}$/);
    });

    it('should return 404 when account does not exist', async () => {
      const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(
        `/api/v1/accounts/${nonExistentUuid}/balance`
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(response.body.error.message).toMatch(/was not found/i);
    });

    it('should reject malformed account ID format in URL with 400', async () => {
      const response = await request(app).get(
        '/api/v1/accounts/not-a-valid-uuid/balance'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/must be a valid uuid/i);
    });
  });
});
