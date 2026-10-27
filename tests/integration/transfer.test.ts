import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { pool, closeDatabasePool } from '../../src/config/database';
import { cleanupTestAccounts } from '../helpers/db-cleanup';
import { accountRepository } from '../../src/repositories/account.repository';

describe('Money Transfer API (Phase 10)', () => {
  let sourceAccountId: string;
  let destinationAccountId: string;
  const createdAccountIds: string[] = [];

  beforeAll(async () => {
    // 1. Create source account with initial ₹500.00
    const acc1 = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Transfer Source Account' });
    sourceAccountId = acc1.body.id;
    createdAccountIds.push(sourceAccountId);

    await request(app)
      .post(`/api/v1/accounts/${sourceAccountId}/transactions`)
      .send({
        type: 'credit',
        amount: '500.00',
        description: 'Initial funding for transfer tests',
        reference_id: 'xfer-init-funding-01',
      });

    // 2. Create destination account with initial ₹100.00
    const acc2 = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Transfer Destination Account' });
    destinationAccountId = acc2.body.id;
    createdAccountIds.push(destinationAccountId);

    await request(app)
      .post(`/api/v1/accounts/${destinationAccountId}/transactions`)
      .send({
        type: 'credit',
        amount: '100.00',
        description: 'Initial funding for transfer tests',
        reference_id: 'xfer-init-funding-02',
      });
  });

  afterAll(async () => {
    await cleanupTestAccounts(createdAccountIds);
    await closeDatabasePool();
  });

  describe('1. Successful Atomic Transfer', () => {
    it('should debit source, credit destination, and create transfer record atomically', async () => {
      const transferPayload = {
        source_account_id: sourceAccountId,
        destination_account_id: destinationAccountId,
        amount: '150.00',
        reference_id: 'xfer-success-01',
        description: 'Monthly office rent split',
      };

      const response = await request(app)
        .post('/api/v1/transfers')
        .send(transferPayload);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.source_account_id).toBe(sourceAccountId);
      expect(response.body.destination_account_id).toBe(destinationAccountId);
      expect(response.body.amount).toBe('150.00');
      expect(response.body.reference_id).toBe('xfer-success-01');
      expect(response.body.description).toBe('Monthly office rent split');
      expect(response.body.debit_transaction_id).toBeDefined();
      expect(response.body.credit_transaction_id).toBeDefined();
      expect(response.body.created_at).toBeDefined();

      // Verify source balance: 500 - 150 = 350.00
      const sourceBal = await request(app).get(
        `/api/v1/accounts/${sourceAccountId}/balance`
      );
      expect(sourceBal.body.balance).toBe('350.00');

      // Verify destination balance: 100 + 150 = 250.00
      const destBal = await request(app).get(
        `/api/v1/accounts/${destinationAccountId}/balance`
      );
      expect(destBal.body.balance).toBe('250.00');

      // Verify source transaction history has debit entry
      const sourceHistory = await request(app).get(
        `/api/v1/accounts/${sourceAccountId}/transactions?type=debit`
      );
      expect(sourceHistory.body.data.length).toBe(1);
      expect(sourceHistory.body.data[0].amount).toBe('150.00');
      expect(sourceHistory.body.data[0].reference_id).toBe(
        'transfer:xfer-success-01:debit'
      );

      // Verify destination transaction history has credit entry
      const destHistory = await request(app).get(
        `/api/v1/accounts/${destinationAccountId}/transactions?type=credit`
      );
      const matchingCredit = destHistory.body.data.find(
        (tx: any) => tx.reference_id === 'transfer:xfer-success-01:credit'
      );
      expect(matchingCredit).toBeDefined();
      expect(matchingCredit.amount).toBe('150.00');
    });
  });

  describe('2. Validation & Business Rule Enforcement', () => {
    it('should reject transfer when source account has insufficient funds (422)', async () => {
      const response = await request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: sourceAccountId,
          destination_account_id: destinationAccountId,
          amount: '9999.00',
          reference_id: 'xfer-insufficient-01',
          description: 'Excessive transfer',
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
      expect(response.body.error.message).toContain(
        'The source account does not have sufficient funds'
      );

      // Verify balances remained completely unchanged
      const sourceBal = await request(app).get(
        `/api/v1/accounts/${sourceAccountId}/balance`
      );
      expect(sourceBal.body.balance).toBe('350.00');

      const destBal = await request(app).get(
        `/api/v1/accounts/${destinationAccountId}/balance`
      );
      expect(destBal.body.balance).toBe('250.00');
    });

    it('should reject transfer when source and destination are the same account (400)', async () => {
      const response = await request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: sourceAccountId,
          destination_account_id: sourceAccountId,
          amount: '50.00',
          reference_id: 'xfer-same-account-01',
          description: 'Self-transfer attempt',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain(
        'Source and destination accounts must be different.'
      );
    });

    it('should reject transfer when source account does not exist (404)', async () => {
      const nilUuid = '00000000-0000-0000-0000-000000000001';
      const response = await request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: nilUuid,
          destination_account_id: destinationAccountId,
          amount: '50.00',
          reference_id: 'xfer-nonexistent-source-01',
          description: 'Nonexistent source',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(response.body.error.message).toContain('Source account with ID');
    });

    it('should reject transfer when destination account does not exist (404)', async () => {
      const nilUuid = '00000000-0000-0000-0000-000000000002';
      const response = await request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: sourceAccountId,
          destination_account_id: nilUuid,
          amount: '50.00',
          reference_id: 'xfer-nonexistent-dest-01',
          description: 'Nonexistent destination',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(response.body.error.message).toContain('Destination account with ID');
    });
  });

  describe('3. Duplicate Transfer Prevention (Idempotency)', () => {
    it('should reject duplicate transfer submission with 409 Conflict', async () => {
      const payload = {
        source_account_id: sourceAccountId,
        destination_account_id: destinationAccountId,
        amount: '25.00',
        reference_id: 'xfer-idempotent-01',
        description: 'Payment for subscription',
      };

      // 1. Initial submission
      const firstRes = await request(app).post('/api/v1/transfers').send(payload);
      expect(firstRes.status).toBe(201);
      const originalTransferId = firstRes.body.id;

      // Balances after first transfer: Source 350 - 25 = 325, Dest 250 + 25 = 275
      const sourceBalAfter1 = await request(app).get(
        `/api/v1/accounts/${sourceAccountId}/balance`
      );
      expect(sourceBalAfter1.body.balance).toBe('325.00');

      // 2. Retry with exact same reference
      const secondRes = await request(app)
        .post('/api/v1/transfers')
        .send({ ...payload, amount: '25.00' });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error.code).toBe('DUPLICATE_TRANSACTION_REFERENCE');
      expect(secondRes.body.error.message).toContain(
        "A transaction with reference ID 'xfer-idempotent-01' has already been processed"
      );
      expect(secondRes.body.error.details.existing_transfer_id).toBe(
        originalTransferId
      );

      // 3. Confirm money was NOT moved a second time
      const sourceBalAfter2 = await request(app).get(
        `/api/v1/accounts/${sourceAccountId}/balance`
      );
      expect(sourceBalAfter2.body.balance).toBe('325.00');

      const destBalAfter2 = await request(app).get(
        `/api/v1/accounts/${destinationAccountId}/balance`
      );
      expect(destBalAfter2.body.balance).toBe('275.00');
    });
  });

  describe('4. Atomicity and Failure Rollback', () => {
    it('should completely roll back both accounts if mid-transfer failure occurs', async () => {
      const sourceBalBefore = await request(app).get(
        `/api/v1/accounts/${sourceAccountId}/balance`
      );
      const destBalBefore = await request(app).get(
        `/api/v1/accounts/${destinationAccountId}/balance`
      );

      // Simulate failure on second account balance update
      const originalUpdateBalance = accountRepository.updateBalance;
      let callCount = 0;
      const spy = vi
        .spyOn(accountRepository, 'updateBalance')
        .mockImplementation(async (id, balance, client) => {
          callCount++;
          if (callCount === 2) {
            throw new Error('Simulated network interruption during destination balance update');
          }
          return originalUpdateBalance.call(accountRepository, id, balance, client);
        });

      const failedRef = 'xfer-mid-failure-ref-01';
      const response = await request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: sourceAccountId,
          destination_account_id: destinationAccountId,
          amount: '50.00',
          reference_id: failedRef,
          description: 'Simulated failure transfer',
        });

      expect(response.status).toBe(500);

      // Verify no transfer record was created
      const transferDb = await pool.query(
        'SELECT * FROM transfers WHERE reference_id = $1;',
        [failedRef]
      );
      expect(transferDb.rows.length).toBe(0);

      // Verify no orphan transaction rows were created
      const debitDb = await pool.query(
        'SELECT * FROM transactions WHERE reference_id = $1;',
        [`transfer:${failedRef}:debit`]
      );
      expect(debitDb.rows.length).toBe(0);

      const creditDb = await pool.query(
        'SELECT * FROM transactions WHERE reference_id = $1;',
        [`transfer:${failedRef}:credit`]
      );
      expect(creditDb.rows.length).toBe(0);

      // Verify neither account balance changed
      const sourceBalAfter = await request(app).get(
        `/api/v1/accounts/${sourceAccountId}/balance`
      );
      expect(sourceBalAfter.body.balance).toBe(sourceBalBefore.body.balance);

      const destBalAfter = await request(app).get(
        `/api/v1/accounts/${destinationAccountId}/balance`
      );
      expect(destBalAfter.body.balance).toBe(destBalBefore.body.balance);

      spy.mockRestore();
    });
  });

  describe('5. Concurrency & Deadlock Prevention', () => {
    it('should handle simultaneous bidirectional transfers between Account A and B without deadlock', async () => {
      // Account A transfers to B while Account B transfers to A simultaneously
      const req1 = request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: sourceAccountId,
          destination_account_id: destinationAccountId,
          amount: '10.00',
          reference_id: `bidirectional-xfer-${Date.now()}-1`,
          description: 'A to B transfer',
        });

      const req2 = request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: destinationAccountId,
          destination_account_id: sourceAccountId,
          amount: '10.00',
          reference_id: `bidirectional-xfer-${Date.now()}-2`,
          description: 'B to A transfer',
        });

      const [res1, res2] = await Promise.all([req1, req2]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
    });

    it('should prevent overdraft during concurrent transfers exceeding available funds', async () => {
      // Create a fresh account with exactly ₹100.00
      const acc = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Overdraft Test Account' });
      const overdraftSourceId = acc.body.id;
      createdAccountIds.push(overdraftSourceId);

      await request(app)
        .post(`/api/v1/accounts/${overdraftSourceId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'Initial ₹100',
          reference_id: `overdraft-seed-${Date.now()}`,
        });

      // Submit two concurrent transfers of ₹80 and ₹60 (total 140 > 100)
      const t1 = request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: overdraftSourceId,
          destination_account_id: destinationAccountId,
          amount: '80.00',
          reference_id: `conc-overdraft-${Date.now()}-1`,
          description: 'Transfer 80',
        });

      const t2 = request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: overdraftSourceId,
          destination_account_id: destinationAccountId,
          amount: '60.00',
          reference_id: `conc-overdraft-${Date.now()}-2`,
          description: 'Transfer 60',
        });

      const results = await Promise.all([t1, t2]);
      const statuses = results.map((r) => r.status).sort();

      // Exactly one succeeds (201) and the other is rejected for insufficient funds (422)
      expect(statuses).toEqual([201, 422]);

      // Verify the balance never went negative
      const finalBal = await request(app).get(
        `/api/v1/accounts/${overdraftSourceId}/balance`
      );
      const balanceNum = parseFloat(finalBal.body.balance);
      expect(balanceNum).toBeGreaterThanOrEqual(0);
      expect(['20.00', '40.00']).toContain(finalBal.body.balance);
    });
  });
});
