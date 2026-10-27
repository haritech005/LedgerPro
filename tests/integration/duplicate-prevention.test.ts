import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { pool, closeDatabasePool } from '../../src/config/database';
import { cleanupTestAccounts } from '../helpers/db-cleanup';

describe('Duplicate Transaction Prevention and Idempotency (Phase 4)', () => {
  let primaryAccountId: string;
  let secondaryAccountId: string;

  beforeAll(async () => {
    const acc1 = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Idempotency Primary Account' });
    primaryAccountId = acc1.body.id;

    const acc2 = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Idempotency Secondary Account' });
    secondaryAccountId = acc2.body.id;
  });

  afterAll(async () => {
    await cleanupTestAccounts([primaryAccountId, secondaryAccountId]);
    await closeDatabasePool();
  });

  it('should prevent duplicate credit requests and return 409 with original transaction details', async () => {
    const payload = {
      type: 'credit',
      amount: 500.0,
      description: 'Initial seed deposit',
      reference_id: 'REF-IDEMP-CRED-01',
    };

    // 1. Initial submission
    const res1 = await request(app)
      .post(`/api/v1/accounts/${primaryAccountId}/transactions`)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res1.body.reference_id).toBe('REF-IDEMP-CRED-01');
    const originalTxId = res1.body.id;

    // 2. Duplicate submission with exact same reference
    const res2 = await request(app)
      .post(`/api/v1/accounts/${primaryAccountId}/transactions`)
      .send(payload);

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('DUPLICATE_TRANSACTION_REFERENCE');
    expect(res2.body.error.message).toMatch(/already been processed/i);
    expect(res2.body.error.details).toBeDefined();
    expect(res2.body.error.details.reference_id).toBe('REF-IDEMP-CRED-01');
    expect(res2.body.error.details.existing_transaction_id).toBe(originalTxId);

    // 3. Verify balance changed only once (500.00, not 1000.00)
    const dbBalance = await pool.query(
      'SELECT balance FROM accounts WHERE id = $1;',
      [primaryAccountId]
    );
    expect(parseFloat(dbBalance.rows[0].balance).toFixed(2)).toBe('500.00');

    // 4. Verify only one transaction row was saved
    const dbTx = await pool.query(
      'SELECT * FROM transactions WHERE account_id = $1 AND reference_id = $2;',
      [primaryAccountId, 'REF-IDEMP-CRED-01']
    );
    expect(dbTx.rows.length).toBe(1);
  });

  it('should prevent duplicate debit requests and preserve account balance', async () => {
    const payload = {
      type: 'debit',
      amount: 150.0,
      description: 'Utility payment',
      reference_id: 'REF-IDEMP-DEB-01',
    };

    // 1. Initial debit submission (Balance: 500 - 150 = 350)
    const res1 = await request(app)
      .post(`/api/v1/accounts/${primaryAccountId}/transactions`)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res1.body.reference_id).toBe('REF-IDEMP-DEB-01');

    // 2. Duplicate debit submission
    const res2 = await request(app)
      .post(`/api/v1/accounts/${primaryAccountId}/transactions`)
      .send(payload);

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('DUPLICATE_TRANSACTION_REFERENCE');

    // 3. Verify balance is strictly 350.00 (not 200.00)
    const dbBalance = await pool.query(
      'SELECT balance FROM accounts WHERE id = $1;',
      [primaryAccountId]
    );
    expect(parseFloat(dbBalance.rows[0].balance).toFixed(2)).toBe('350.00');

    // 4. Verify only one transaction row was saved
    const dbTx = await pool.query(
      'SELECT * FROM transactions WHERE account_id = $1 AND reference_id = $2;',
      [primaryAccountId, 'REF-IDEMP-DEB-01']
    );
    expect(dbTx.rows.length).toBe(1);
  });

  it('should permit the same reference ID on a different account without conflict', async () => {
    const sharedReference = 'SHARED-INVOICE-999';

    // Transaction on Primary Account
    const res1 = await request(app)
      .post(`/api/v1/accounts/${primaryAccountId}/transactions`)
      .send({
        type: 'credit',
        amount: 100.0,
        description: 'Invoice payment Primary',
        reference_id: sharedReference,
      });
    expect(res1.status).toBe(201);

    // Same reference on Secondary Account succeeds
    const res2 = await request(app)
      .post(`/api/v1/accounts/${secondaryAccountId}/transactions`)
      .send({
        type: 'credit',
        amount: 200.0,
        description: 'Invoice payment Secondary',
        reference_id: sharedReference,
      });
    expect(res2.status).toBe(201);

    // Verify both accounts stored the reference independently
    const dbTx = await pool.query(
      'SELECT * FROM transactions WHERE reference_id = $1;',
      [sharedReference]
    );
    expect(dbTx.rows.length).toBe(2);
  });

  it('should handle simultaneous concurrent duplicate requests safely (Race Condition)', async () => {
    const concurrentRef = 'CONCURRENT-BURST-001';
    const amount = 50.0;
    const burstSize = 8;

    // Send 8 simultaneous identical requests
    const requests = Array.from({ length: burstSize }).map(() =>
      request(app)
        .post(`/api/v1/accounts/${secondaryAccountId}/transactions`)
        .send({
          type: 'credit',
          amount,
          description: 'Concurrent race condition test',
          reference_id: concurrentRef,
        })
    );

    const responses = await Promise.all(requests);

    // Exactly 1 request must succeed (HTTP 201)
    const successResponses = responses.filter((r) => r.status === 201);
    expect(successResponses.length).toBe(1);

    // Exactly 7 requests must receive HTTP 409 Conflict
    const conflictResponses = responses.filter((r) => r.status === 409);
    expect(conflictResponses.length).toBe(burstSize - 1);

    for (const conf of conflictResponses) {
      expect(conf.body.error.code).toBe('DUPLICATE_TRANSACTION_REFERENCE');
    }

    // Verify exactly 1 transaction was inserted in database
    const dbTx = await pool.query(
      'SELECT * FROM transactions WHERE account_id = $1 AND reference_id = $2;',
      [secondaryAccountId, concurrentRef]
    );
    expect(dbTx.rows.length).toBe(1);

    // Secondary account had 200 before, now must be 200 + 50 = 250.00 (not 200 + 400 = 600)
    const dbBalance = await pool.query(
      'SELECT balance FROM accounts WHERE id = $1;',
      [secondaryAccountId]
    );
    expect(parseFloat(dbBalance.rows[0].balance).toFixed(2)).toBe('250.00');
  });
});
