import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { closeDatabasePool } from '../../src/config/database';
import { cleanupTestAccounts } from '../helpers/db-cleanup';

describe('Comprehensive Validation (Phase 8)', () => {
  let validAccountId: string;
  const createdAccountIds: string[] = [];

  beforeAll(async () => {
    const acc = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Validation Primary Account' });
    validAccountId = acc.body.id;
    createdAccountIds.push(validAccountId);
  });

  afterAll(async () => {
    await cleanupTestAccounts(createdAccountIds);
    await closeDatabasePool();
  });

  describe('1. Account Creation Validation (POST /api/v1/accounts)', () => {
    it('should reject missing name field with 400', async () => {
      const res = await request(app).post('/api/v1/accounts').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Account holder name is required');
    });

    it('should reject null name field with 400', async () => {
      const res = await request(app).post('/api/v1/accounts').send({ name: null });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Account holder name is required');
    });

    it('should reject non-string name types with 400', async () => {
      const numberRes = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 12345 });
      expect(numberRes.status).toBe(400);
      expect(numberRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(numberRes.body.error.message).toBe('Account holder name must be a string');

      const boolRes = await request(app)
        .post('/api/v1/accounts')
        .send({ name: true });
      expect(boolRes.status).toBe(400);
      expect(boolRes.body.error.message).toBe('Account holder name must be a string');
    });

    it('should reject empty string name with 400', async () => {
      const res = await request(app).post('/api/v1/accounts').send({ name: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Account holder name cannot be empty or whitespace only'
      );
    });

    it('should reject whitespace-only name with 400', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .send({ name: '     ' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Account holder name cannot be empty or whitespace only'
      );
    });

    it('should reject name exceeding 255 characters with 400', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'A'.repeat(256) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Account holder name cannot exceed 255 characters'
      );
    });

    it('should accept name with exact 255 boundary characters', async () => {
      const validLongName = 'A'.repeat(255);
      const res = await request(app)
        .post('/api/v1/accounts')
        .send({ name: validLongName });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(validLongName);
      createdAccountIds.push(res.body.id);
    });

    it('should reject client-supplied balance with 400', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Jane Doe', balance: 500.0 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Initial balance cannot be provided');
    });

    it('should reject client-supplied account ID with 400', async () => {
      const res = await request(app).post('/api/v1/accounts').send({
        name: 'Jane Doe',
        id: '00000000-0000-0000-0000-000000000001',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Account ID is system-generated');
    });

    it('should reject client-supplied created_at with 400', async () => {
      const res = await request(app).post('/api/v1/accounts').send({
        name: 'Jane Doe',
        created_at: new Date().toISOString(),
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain(
        'Account creation timestamp is system-generated'
      );
    });

    it('should reject unexpected extra fields with 400', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Jane Doe', extraField: 'unauthorized', admin: true });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Unrecognized field(s)');
    });

    it('should reject non-object body payload (e.g. array) with 400', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .send([{ name: 'Array Payload' }]);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Request body must be a valid JSON object.');
    });

    it('should reject unexpected query parameters on POST /accounts with 400', async () => {
      const res = await request(app)
        .post('/api/v1/accounts?foo=bar')
        .send({ name: 'Jane Query Test' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('2. Account Balance Endpoint Validation (GET /api/v1/accounts/:accountId/balance)', () => {
    it('should reject malformed non-UUID account ID with 400', async () => {
      const res = await request(app).get('/api/v1/accounts/not-a-valid-uuid/balance');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Invalid account ID format. Must be a valid UUID.'
      );
    });

    it('should reject unexpected query parameters on GET balance with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/balance?extra=parameter`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Transaction Creation Validation (POST /api/v1/accounts/:accountId/transactions)', () => {
    it('should reject malformed account ID path parameter with 400', async () => {
      const res = await request(app)
        .post('/api/v1/accounts/12345/transactions')
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'Valid desc',
          reference_id: 'ref-1',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Invalid account ID format. Must be a valid UUID.'
      );
    });

    it('should reject missing required transaction fields with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid transaction type with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'transfer',
          amount: '100.00',
          description: 'Test transfer',
          reference_id: 'ref-invalid-type',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        "Invalid transaction type. Must be either 'credit' or 'debit'."
      );
    });

    it('should reject zero amount with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '0.00',
          description: 'Zero credit',
          reference_id: 'ref-zero',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Amount must be greater than zero');
    });

    it('should reject negative amounts with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '-50.00',
          description: 'Negative credit',
          reference_id: 'ref-negative',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Invalid amount. Must be a positive amount with at most 2 decimal places.'
      );
    });

    it('should reject excessive decimal precision (> 2 decimal places) with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '10.555',
          description: 'Excessive precision',
          reference_id: 'ref-precision',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Invalid amount. Must be a positive amount with at most 2 decimal places.'
      );
    });

    it('should reject non-numeric amount string with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: 'one hundred',
          description: 'Text amount',
          reference_id: 'ref-text-amount',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Invalid amount. Must be a positive amount with at most 2 decimal places.'
      );
    });

    it('should reject amount exceeding maximum limit (1,000,000,000) with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '1000000001.00',
          description: 'Excessive amount',
          reference_id: 'ref-excessive-amount',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Amount cannot exceed 1,000,000,000');
    });

    it('should reject empty description with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: '',
          reference_id: 'ref-empty-desc',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Transaction description cannot be empty or whitespace only'
      );
    });

    it('should reject whitespace-only description with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: '    ',
          reference_id: 'ref-ws-desc',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Transaction description cannot be empty or whitespace only'
      );
    });

    it('should reject description exceeding 500 characters with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'D'.repeat(501),
          reference_id: 'ref-long-desc',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Transaction description cannot exceed 500 characters'
      );
    });

    it('should reject empty reference_id with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'Valid description',
          reference_id: '',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Transaction reference ID cannot be empty or whitespace only'
      );
    });

    it('should reject whitespace-only reference_id with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'Valid description',
          reference_id: '   ',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Transaction reference ID cannot be empty or whitespace only'
      );
    });

    it('should reject reference_id exceeding 255 characters with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'Valid description',
          reference_id: 'R'.repeat(256),
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Transaction reference ID cannot exceed 255 characters'
      );
    });

    it('should reject client-supplied id, created_at, or account_id in body with 400', async () => {
      const idRes = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          id: '00000000-0000-0000-0000-000000000002',
          type: 'credit',
          amount: '50.00',
          description: 'Client ID',
          reference_id: 'ref-sys-1',
        });
      expect(idRes.status).toBe(400);
      expect(idRes.body.error.message).toContain('Transaction ID is system-generated');

      const createdRes = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          created_at: new Date().toISOString(),
          type: 'credit',
          amount: '50.00',
          description: 'Client created_at',
          reference_id: 'ref-sys-2',
        });
      expect(createdRes.status).toBe(400);
      expect(createdRes.body.error.message).toContain(
        'Transaction creation timestamp is system-generated'
      );

      const accIdRes = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          account_id: validAccountId,
          type: 'credit',
          amount: '50.00',
          description: 'Client account_id',
          reference_id: 'ref-sys-3',
        });
      expect(accIdRes.status).toBe(400);
      expect(accIdRes.body.error.message).toContain(
        'Account ID is derived from the URL path'
      );
    });

    it('should reject unexpected extra fields in transaction body with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '50.00',
          description: 'Valid description',
          reference_id: 'ref-extra-field',
          category: 'finance',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Unrecognized field(s): category');
    });

    it('should accept exact boundary values: 500 char desc, 255 char ref, max amount 1B', async () => {
      const maxDesc = 'D'.repeat(500);
      const maxRef = 'R'.repeat(255);
      const res = await request(app)
        .post(`/api/v1/accounts/${validAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '1000000000.00',
          description: maxDesc,
          reference_id: maxRef,
        });
      expect(res.status).toBe(201);
      expect(res.body.description).toBe(maxDesc);
      expect(res.body.reference_id).toBe(maxRef);
      expect(res.body.amount).toBe('1000000000.00');
    });
  });

  describe('4. Transaction History Query Validation (GET /api/v1/accounts/:accountId/transactions)', () => {
    it('should reject invalid transaction type filter with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?type=unknown`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        "Invalid transaction type filter. Must be either 'credit' or 'debit'."
      );
    });

    it('should reject page = 0 with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?page=0`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Page must be greater than zero');
    });

    it('should reject negative page with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?page=-2`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Page must be greater than zero');
    });

    it('should reject non-numeric page with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?page=abc`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Page must be a valid positive integer');
    });

    it('should reject non-integer page with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?page=1.5`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Page must be an integer');
    });

    it('should reject limit = 0 with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?limit=0`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Limit must be greater than zero');
    });

    it('should reject limit exceeding 100 with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?limit=101`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe(
        'Limit cannot exceed maximum of 100 records per page'
      );
    });

    it('should accept boundary limit = 100 with 200 OK', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?limit=100`
      );
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
    });

    it('should reject unrecognized query parameters with 400', async () => {
      const res = await request(app).get(
        `/api/v1/accounts/${validAccountId}/transactions?sort=asc&extra=test`
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
