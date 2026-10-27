import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { closeDatabasePool } from '../../src/config/database';
import { cleanupTestAccounts } from '../helpers/db-cleanup';

describe('Transaction History, Filtering, Pagination, and Sorting (Phase 6)', () => {
  let testAccountId: string;
  let emptyAccountId: string;

  beforeAll(async () => {
    // 1. Create main test account
    const acc1 = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'History Test Holder' });
    testAccountId = acc1.body.id;

    // 2. Create empty account with no transactions
    const acc2 = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Empty History Holder' });
    emptyAccountId = acc2.body.id;

    // 3. Seed 5 chronological transactions: 3 credits, 2 debits
    const seedTransactions = [
      { type: 'credit', amount: 100.0, description: 'Tx 1 Credit', reference_id: 'HIST-SEED-01' },
      { type: 'credit', amount: 200.0, description: 'Tx 2 Credit', reference_id: 'HIST-SEED-02' },
      { type: 'debit', amount: 50.0, description: 'Tx 3 Debit', reference_id: 'HIST-SEED-03' },
      { type: 'debit', amount: 30.0, description: 'Tx 4 Debit', reference_id: 'HIST-SEED-04' },
      { type: 'credit', amount: 300.0, description: 'Tx 5 Credit', reference_id: 'HIST-SEED-05' },
    ];

    for (const tx of seedTransactions) {
      const res = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send(tx);
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await cleanupTestAccounts([testAccountId, emptyAccountId]);
    await closeDatabasePool();
  });

  describe('GET /api/v1/accounts/:accountId/transactions', () => {
    it('1. should retrieve all transactions when no filter is provided', async () => {
      const response = await request(app).get(
        `/api/v1/accounts/${testAccountId}/transactions`
      );

      expect(response.status).toBe(200);
      expect(response.body.account_id).toBe(testAccountId);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(10);
      expect(response.body.total_records).toBe(5);
      expect(response.body.total_pages).toBe(1);
      expect(response.body.data.length).toBe(5);
    });

    it('2. should filter transactions by credit type', async () => {
      const response = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ type: 'credit' });

      expect(response.status).toBe(200);
      expect(response.body.total_records).toBe(3);
      expect(response.body.data.length).toBe(3);
      for (const item of response.body.data) {
        expect(item.type).toBe('credit');
      }
    });

    it('3. should filter transactions by debit type', async () => {
      const response = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ type: 'debit' });

      expect(response.status).toBe(200);
      expect(response.body.total_records).toBe(2);
      expect(response.body.data.length).toBe(2);
      for (const item of response.body.data) {
        expect(item.type).toBe('debit');
      }
    });

    it('4. should correctly paginate across multiple pages', async () => {
      // Page 1 (limit 2)
      const page1 = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ page: 1, limit: 2 });

      expect(page1.status).toBe(200);
      expect(page1.body.page).toBe(1);
      expect(page1.body.limit).toBe(2);
      expect(page1.body.total_records).toBe(5);
      expect(page1.body.total_pages).toBe(3);
      expect(page1.body.data.length).toBe(2);

      // Page 2 (limit 2)
      const page2 = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ page: 2, limit: 2 });

      expect(page2.status).toBe(200);
      expect(page2.body.page).toBe(2);
      expect(page2.body.data.length).toBe(2);

      // Page 3 (limit 2) -> remainder 1 record
      const page3 = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ page: 3, limit: 2 });

      expect(page3.status).toBe(200);
      expect(page3.body.page).toBe(3);
      expect(page3.body.data.length).toBe(1);

      // Ensure no overlapping IDs between page 1 and page 2
      const page1Ids = page1.body.data.map((t: any) => t.id);
      const page2Ids = page2.body.data.map((t: any) => t.id);
      expect(page1Ids).not.toEqual(expect.arrayContaining(page2Ids));
    });

    it('5. should return empty array for out-of-range page or empty account', async () => {
      const outOfRange = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ page: 10, limit: 10 });

      expect(outOfRange.status).toBe(200);
      expect(outOfRange.body.page).toBe(10);
      expect(outOfRange.body.total_records).toBe(5);
      expect(outOfRange.body.data).toEqual([]);

      const emptyAccount = await request(app).get(
        `/api/v1/accounts/${emptyAccountId}/transactions`
      );

      expect(emptyAccount.status).toBe(200);
      expect(emptyAccount.body.total_records).toBe(0);
      expect(emptyAccount.body.total_pages).toBe(0);
      expect(emptyAccount.body.data).toEqual([]);
    });

    it('6. should reject invalid pagination parameters with 400', async () => {
      const zeroPage = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ page: 0 });
      expect(zeroPage.status).toBe(400);
      expect(zeroPage.body.error.code).toBe('VALIDATION_ERROR');

      const negativeLimit = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ limit: -5 });
      expect(negativeLimit.status).toBe(400);
      expect(negativeLimit.body.error.code).toBe('VALIDATION_ERROR');

      const excessiveLimit = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ limit: 150 });
      expect(excessiveLimit.status).toBe(400);
      expect(excessiveLimit.body.error.code).toBe('VALIDATION_ERROR');
      expect(excessiveLimit.body.error.message).toMatch(/cannot exceed maximum of 100/i);

      const nonNumericPage = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ page: 'abc' });
      expect(nonNumericPage.status).toBe(400);
      expect(nonNumericPage.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('7. should reject invalid transaction type filter with 400', async () => {
      const response = await request(app)
        .get(`/api/v1/accounts/${testAccountId}/transactions`)
        .query({ type: 'deposit' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/credit.*debit/i);
    });

    it('8. should return transactions latest-first (DESC created_at)', async () => {
      const response = await request(app).get(
        `/api/v1/accounts/${testAccountId}/transactions`
      );

      expect(response.status).toBe(200);
      const items = response.body.data;

      // The 5th seeded transaction (HIST-SEED-05) was created last, so it must be first
      expect(items[0].reference_id).toBe('HIST-SEED-05');
      expect(items[items.length - 1].reference_id).toBe('HIST-SEED-01');

      // Verify descending chronological order
      for (let i = 0; i < items.length - 1; i++) {
        const current = new Date(items[i].created_at).getTime();
        const next = new Date(items[i + 1].created_at).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });

    it('9. should return 404 when account does not exist', async () => {
      const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(
        `/api/v1/accounts/${nonExistentUuid}/transactions`
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('10. should reject malformed account ID in URL with 400', async () => {
      const response = await request(app).get(
        '/api/v1/accounts/invalid-uuid/transactions'
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
