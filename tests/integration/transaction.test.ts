import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { pool, closeDatabasePool } from '../../src/config/database';

describe('Credit and Debit Transactions (Phase 3)', () => {
  let testAccountId: string;
  let secondaryAccountId: string;

  beforeAll(async () => {
    // Create test accounts
    const acc1 = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Transaction Test Account' });
    testAccountId = acc1.body.id;

    const acc2 = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Secondary Test Account' });
    secondaryAccountId = acc2.body.id;
  });

  afterAll(async () => {
    // Cleanup created test records
    if (testAccountId || secondaryAccountId) {
      await pool.query('DELETE FROM transactions WHERE account_id IN ($1, $2);', [
        testAccountId,
        secondaryAccountId,
      ]);
      await pool.query('DELETE FROM accounts WHERE id IN ($1, $2);', [
        testAccountId,
        secondaryAccountId,
      ]);
    }
    await closeDatabasePool();
  });

  describe('POST /api/v1/accounts/:accountId/transactions', () => {
    it('should successfully credit an account and update the balance atomically', async () => {
      const response = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: 500.0,
          description: 'Initial deposit',
          reference_id: 'CREDIT-TEST-001',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.account_id).toBe(testAccountId);
      expect(response.body.type).toBe('credit');
      expect(response.body.amount).toBe('500.00');
      expect(response.body.description).toBe('Initial deposit');
      expect(response.body.reference_id).toBe('CREDIT-TEST-001');
      expect(response.body).toHaveProperty('created_at');

      // Verify balance in database
      const dbRes = await pool.query('SELECT balance FROM accounts WHERE id = $1;', [
        testAccountId,
      ]);
      expect(parseFloat(dbRes.rows[0].balance).toFixed(2)).toBe('500.00');
    });

    it('should successfully debit an account with sufficient funds', async () => {
      const response = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'debit',
          amount: 200.0,
          description: 'ATM withdrawal',
          reference_id: 'DEBIT-TEST-001',
        });

      expect(response.status).toBe(201);
      expect(response.body.type).toBe('debit');
      expect(response.body.amount).toBe('200.00');

      // Verify balance in database (500 - 200 = 300)
      const dbRes = await pool.query('SELECT balance FROM accounts WHERE id = $1;', [
        testAccountId,
      ]);
      expect(parseFloat(dbRes.rows[0].balance).toFixed(2)).toBe('300.00');
    });

    it('should reject a debit when funds are insufficient and leave account unchanged', async () => {
      const response = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'debit',
          amount: 400.0, // Current balance is 300
          description: 'Overdraft attempt',
          reference_id: 'DEBIT-FAIL-001',
        });

      expect(response.status).toBe(422);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');

      // Verify balance remains unchanged at 300.00
      const dbRes = await pool.query('SELECT balance FROM accounts WHERE id = $1;', [
        testAccountId,
      ]);
      expect(parseFloat(dbRes.rows[0].balance).toFixed(2)).toBe('300.00');

      // Verify failed transaction was not recorded in the ledger
      const txRes = await pool.query(
        'SELECT * FROM transactions WHERE reference_id = $1;',
        ['DEBIT-FAIL-001']
      );
      expect(txRes.rows.length).toBe(0);
    });

    it('should reject zero or negative amounts', async () => {
      const zeroResponse = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: 0,
          description: 'Zero amount',
          reference_id: 'ZERO-TEST-001',
        });
      expect(zeroResponse.status).toBe(400);
      expect(zeroResponse.body.error.code).toBe('VALIDATION_ERROR');

      const negativeResponse = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: -50.0,
          description: 'Negative amount',
          reference_id: 'NEG-TEST-001',
        });
      expect(negativeResponse.status).toBe(400);
      expect(negativeResponse.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject unsupported monetary precision (> 2 decimal places)', async () => {
      const response = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: 50.555,
          description: 'Fractional cents',
          reference_id: 'PRECISION-TEST-001',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/at most 2 decimal places/i);
    });

    it('should reject unsupported transaction types', async () => {
      const response = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'deposit', // Only 'credit' or 'debit' allowed
          amount: 50.0,
          description: 'Invalid type',
          reference_id: 'TYPE-TEST-001',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/must be either 'credit' or 'debit'/i);
    });

    it('should return 404 when account does not exist', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .post(`/api/v1/accounts/${nonExistentId}/transactions`)
        .send({
          type: 'credit',
          amount: 100.0,
          description: 'Missing account',
          reference_id: 'MISSING-ACC-001',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('should reject malformed account ID format in URL path', async () => {
      const response = await request(app)
        .post('/api/v1/accounts/not-a-valid-uuid/transactions')
        .send({
          type: 'credit',
          amount: 100.0,
          description: 'Malformed ID',
          reference_id: 'MALFORMED-ID-001',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toMatch(/must be a valid uuid/i);
    });

    it('should enforce unique reference constraint per account', async () => {
      // First transaction with REF-DUP-001 succeeds
      const first = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: 50.0,
          description: 'First reference submission',
          reference_id: 'REF-DUP-001',
        });
      expect(first.status).toBe(201);

      // Repeated submission with same reference on same account fails with 409
      const second = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: 50.0,
          description: 'Duplicate reference submission',
          reference_id: 'REF-DUP-001',
        });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('DUPLICATE_TRANSACTION_REFERENCE');

      // Same reference on a different account succeeds
      const differentAccount = await request(app)
        .post(`/api/v1/accounts/${secondaryAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: 50.0,
          description: 'Same reference on different account',
          reference_id: 'REF-DUP-001',
        });
      expect(differentAccount.status).toBe(201);
    });
  });
});
