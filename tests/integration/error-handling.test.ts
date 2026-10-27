import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { closeDatabasePool } from '../../src/config/database';
import { cleanupTestAccounts } from '../helpers/db-cleanup';
import { accountRepository } from '../../src/repositories/account.repository';

describe('Centralized Error Handling (Phase 9)', () => {
  let testAccountId: string;

  beforeAll(async () => {
    const acc = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Error Handling Test Account' });
    testAccountId = acc.body.id;
  });

  afterAll(async () => {
    await cleanupTestAccounts([testAccountId]);
    await closeDatabasePool();
  });

  describe('1. Malformed JSON Handling (400 Bad Request)', () => {
    it('should catch malformed JSON and return standardized INVALID_JSON error', async () => {
      const response = await request(app)
        .post('/api/v1/accounts')
        .set('Content-Type', 'application/json')
        .send('{"name": "Broken JSON'); // intentionally broken JSON

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'INVALID_JSON',
          message: 'Malformed JSON payload in request body.',
        },
      });
    });
  });

  describe('2. Unmapped Route Handling (404 Not Found)', () => {
    it('should return standardized NOT_FOUND error for nonexistent routes', async () => {
      const response = await request(app).get('/api/v1/nonexistent-path');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toContain('Cannot GET /api/v1/nonexistent-path');
    });
  });

  describe('3. Resource Not Found Handling (404 Not Found)', () => {
    it('should return ACCOUNT_NOT_FOUND when account ID does not exist in database', async () => {
      const nilUuid = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/v1/accounts/${nilUuid}/balance`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: {
          code: 'ACCOUNT_NOT_FOUND',
          message: `Account with ID '${nilUuid}' was not found.`,
          details: {
            account_id: nilUuid,
          },
        },
      });
    });
  });

  describe('4. Input Validation Error Handling (400 Bad Request)', () => {
    it('should return standardized VALIDATION_ERROR with field details', async () => {
      const response = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'invalid_type',
          amount: 'not_a_number',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(typeof response.body.error.message).toBe('string');
      expect(Array.isArray(response.body.error.details)).toBe(true);
    });
  });

  describe('5. Duplicate Transaction Conflict (409 Conflict)', () => {
    it('should return DUPLICATE_TRANSACTION_REFERENCE with existing transaction details', async () => {
      const txPayload = {
        type: 'credit',
        amount: '100.00',
        description: 'First attempt',
        reference_id: 'err-dup-ref-01',
      };

      const firstRes = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send(txPayload);
      expect(firstRes.status).toBe(201);

      // Repeat with same reference
      const secondRes = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({ ...txPayload, description: 'Second attempt' });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error.code).toBe('DUPLICATE_TRANSACTION_REFERENCE');
      expect(secondRes.body.error.message).toContain(
        "A transaction with reference ID 'err-dup-ref-01' has already been processed"
      );
      expect(secondRes.body.error.details).toBeDefined();
      expect(secondRes.body.error.details.reference_id).toBe('err-dup-ref-01');
      expect(secondRes.body.error.details.existing_transaction_id).toBe(firstRes.body.id);
    });
  });

  describe('6. Insufficient Balance Handling (422 Unprocessable Content)', () => {
    it('should return INSUFFICIENT_BALANCE when debit exceeds account balance', async () => {
      const response = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'debit',
          amount: '999999.00',
          description: 'Excessive debit attempt',
          reference_id: 'err-insufficient-01',
        });

      expect(response.status).toBe(422);
      expect(response.body).toEqual({
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'The account does not have sufficient funds.',
        },
      });
    });
  });

  describe('7. Method Not Allowed on Immutable Ledger (405 Method Not Allowed)', () => {
    it('should return METHOD_NOT_ALLOWED and Allow header for prohibited HTTP verbs', async () => {
      const response = await request(app).delete(
        `/api/v1/accounts/${testAccountId}/transactions`
      );

      expect(response.status).toBe(405);
      expect(response.headers['allow']).toContain('GET, POST');
      expect(response.body).toEqual({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message:
            'Transaction records are immutable. Modifying or deleting transactions is strictly prohibited.',
        },
      });
    });
  });

  describe('8. Unexpected Server Errors and Sensitive Data Sanitization (500 Internal Server Error)', () => {
    it('should sanitize 500 errors and strictly avoid exposing SQL, stack traces, or credentials', async () => {
      // Simulate raw internal database failure containing sensitive connection details
      const sensitiveErrorMessage =
        'FATAL: password authentication failed for user "postgres" at host 192.168.1.100. SELECT * FROM secret_table;';

      const repoSpy = vi
        .spyOn(accountRepository, 'findById')
        .mockRejectedValueOnce(new Error(sensitiveErrorMessage));

      const response = await request(app).get(
        `/api/v1/accounts/${testAccountId}/balance`
      );

      expect(response.status).toBe(500);

      // Verify standardized error contract
      expect(response.body).toEqual({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected internal server error occurred.',
        },
      });

      // Verify no sensitive details, SQL queries, credentials, or stack traces leaked
      const rawBody = JSON.stringify(response.body);
      expect(rawBody).not.toContain('password');
      expect(rawBody).not.toContain('postgres');
      expect(rawBody).not.toContain('192.168.1.100');
      expect(rawBody).not.toContain('secret_table');
      expect(rawBody).not.toContain('SELECT');
      expect(rawBody).not.toContain('stack');

      repoSpy.mockRestore();
    });

    it('should sanitize raw PostgreSQL errors with SQLSTATE codes to INTERNAL_SERVER_ERROR', async () => {
      // Simulate raw PG error with code '42P01' (undefined_table)
      const rawPgError: any = new Error('relation "nonexistent_table" does not exist');
      rawPgError.code = '42P01';
      rawPgError.severity = 'ERROR';

      const repoSpy = vi
        .spyOn(accountRepository, 'findById')
        .mockRejectedValueOnce(rawPgError);

      const response = await request(app).get(
        `/api/v1/accounts/${testAccountId}/balance`
      );

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(response.body.error.message).toBe(
        'An unexpected internal server error occurred.'
      );

      // Verify raw SQLSTATE code was NOT exposed as error.code
      expect(response.body.error.code).not.toBe('42P01');

      repoSpy.mockRestore();
    });
  });
});
