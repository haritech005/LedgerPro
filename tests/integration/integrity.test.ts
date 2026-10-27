import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { pool, closeDatabasePool } from '../../src/config/database';
import { cleanupTestAccounts } from '../helpers/db-cleanup';
import { accountRepository } from '../../src/repositories/account.repository';

describe('Data Integrity, Immutability, and Atomicity (Phase 7)', () => {
  let testAccountId: string;
  let testTxId: string;

  beforeAll(async () => {
    // Create an account and an initial transaction for testing
    const acc = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Integrity & Immutability Test Account' });
    testAccountId = acc.body.id;

    const tx = await request(app)
      .post(`/api/v1/accounts/${testAccountId}/transactions`)
      .send({
        type: 'credit',
        amount: '100.00',
        description: 'Initial funding',
        reference_id: 'immut-initial-01',
      });
    testTxId = tx.body.id;
  });

  afterAll(async () => {
    await cleanupTestAccounts([testAccountId]);
    await closeDatabasePool();
  });

  describe('1. Database-Level Ledger Immutability Guards', () => {
    it('should strictly prohibit direct SQL UPDATE on transactions table', async () => {
      await expect(
        pool.query('UPDATE transactions SET amount = 999.00 WHERE id = $1;', [
          testTxId,
        ])
      ).rejects.toThrow(/Transaction records are immutable: UPDATE operations are strictly prohibited/i);

      // Verify transaction amount was not altered
      const txRes = await pool.query(
        'SELECT amount FROM transactions WHERE id = $1;',
        [testTxId]
      );
      expect(parseFloat(txRes.rows[0].amount).toFixed(2)).toBe('100.00');
    });

    it('should strictly prohibit direct SQL DELETE on transactions table', async () => {
      await expect(
        pool.query('DELETE FROM transactions WHERE id = $1;', [testTxId])
      ).rejects.toThrow(/Transaction records are immutable: DELETE operations are strictly prohibited/i);

      // Verify transaction record still exists
      const txRes = await pool.query(
        'SELECT id FROM transactions WHERE id = $1;',
        [testTxId]
      );
      expect(txRes.rows.length).toBe(1);
    });

    it('should strictly prohibit direct SQL TRUNCATE on transactions table', async () => {
      await expect(
        pool.query('TRUNCATE transactions CASCADE;')
      ).rejects.toThrow(/Transaction records are immutable: TRUNCATE operations are strictly prohibited/i);
    });

    it('should prevent deletion of an account that has associated transactions (Foreign Key ON DELETE RESTRICT)', async () => {
      await expect(
        pool.query('DELETE FROM accounts WHERE id = $1;', [testAccountId])
      ).rejects.toThrow(/foreign key constraint/i);
    });

    it('should strictly reject negative account balance at database constraint level', async () => {
      await expect(
        pool.query('UPDATE accounts SET balance = -50.00 WHERE id = $1;', [
          testAccountId,
        ])
      ).rejects.toThrow(/chk_accounts_balance_non_negative/i);
    });
  });

  describe('2. API-Level Immutability and Prohibited Methods', () => {
    it('should reject PUT /api/v1/accounts/:accountId/transactions with 405 Method Not Allowed', async () => {
      const response = await request(app)
        .put(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({ amount: '500.00' });

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

    it('should reject DELETE /api/v1/accounts/:accountId/transactions with 405 Method Not Allowed', async () => {
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

    it('should reject PUT /api/v1/accounts/:accountId/transactions/:transactionId with 405 Method Not Allowed', async () => {
      const response = await request(app)
        .put(`/api/v1/accounts/${testAccountId}/transactions/${testTxId}`)
        .send({ amount: '200.00' });

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

    it('should reject DELETE /api/v1/accounts/:accountId/transactions/:transactionId with 405 Method Not Allowed', async () => {
      const response = await request(app).delete(
        `/api/v1/accounts/${testAccountId}/transactions/${testTxId}`
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

    it('should reject PATCH /api/v1/accounts/:accountId/transactions/:transactionId with 405 Method Not Allowed', async () => {
      const response = await request(app)
        .patch(`/api/v1/accounts/${testAccountId}/transactions/${testTxId}`)
        .send({ description: 'Altered description' });

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

  describe('3. Atomicity and Rollback on Mid-Operation Failure', () => {
    it('should rollback transaction creation if balance update fails midway', async () => {
      // 1. Check current balance
      const balanceBefore = await pool.query(
        'SELECT balance FROM accounts WHERE id = $1;',
        [testAccountId]
      );
      const originalBalance = balanceBefore.rows[0].balance;

      // 2. Mock accountRepository.updateBalance to simulate sudden database connection failure
      const updateBalanceSpy = vi
        .spyOn(accountRepository, 'updateBalance')
        .mockRejectedValueOnce(
          new Error('Simulated database connection failure during balance update')
        );

      const failedRef = 'fail-mid-operation-ref';
      const response = await request(app)
        .post(`/api/v1/accounts/${testAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '75.00',
          description: 'Failure test credit',
          reference_id: failedRef,
        });

      expect(response.status).toBe(500);

      // 3. Verify no transaction record was persisted in database
      const txRes = await pool.query(
        'SELECT * FROM transactions WHERE reference_id = $1;',
        [failedRef]
      );
      expect(txRes.rows.length).toBe(0);

      // 4. Verify account balance was NOT modified
      const balanceAfter = await pool.query(
        'SELECT balance FROM accounts WHERE id = $1;',
        [testAccountId]
      );
      expect(balanceAfter.rows[0].balance).toBe(originalBalance);

      // Restore spy
      updateBalanceSpy.mockRestore();
    });
  });

  describe('4. Ledger Consistency Across Mixed Successful and Failed Operations (PRD Section 7)', () => {
    let ledgerAccountId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'PRD Ledger Verification Account' });
      ledgerAccountId = res.body.id;
    });

    afterAll(async () => {
      await cleanupTestAccounts([ledgerAccountId]);
    });

    it('should maintain exact mathematical balance across successful, rejected, and duplicate operations', async () => {
      // 1. Initial balance: 0.00
      const initialBal = await request(app).get(
        `/api/v1/accounts/${ledgerAccountId}/balance`
      );
      expect(initialBal.body.balance).toBe('0.00');

      // 2. Credit 100.00 -> 100.00
      const c1 = await request(app)
        .post(`/api/v1/accounts/${ledgerAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'PRD credit 1',
          reference_id: 'prd-seq-01',
        });
      expect(c1.status).toBe(201);

      // 3. Credit 50.00 -> 150.00
      const c2 = await request(app)
        .post(`/api/v1/accounts/${ledgerAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '50.00',
          description: 'PRD credit 2',
          reference_id: 'prd-seq-02',
        });
      expect(c2.status).toBe(201);

      // 4. Rejected debit 200.00 (exceeds 150.00) -> 422
      const rejectedDebit = await request(app)
        .post(`/api/v1/accounts/${ledgerAccountId}/transactions`)
        .send({
          type: 'debit',
          amount: '200.00',
          description: 'PRD rejected debit',
          reference_id: 'prd-seq-rejected-01',
        });
      expect(rejectedDebit.status).toBe(422);

      // 5. Duplicate credit 50.00 (same reference as c2) -> 409
      const dupCredit = await request(app)
        .post(`/api/v1/accounts/${ledgerAccountId}/transactions`)
        .send({
          type: 'credit',
          amount: '50.00',
          description: 'PRD duplicate credit attempt',
          reference_id: 'prd-seq-02',
        });
      expect(dupCredit.status).toBe(409);

      // 6. Debit 30.00 -> 120.00
      const d1 = await request(app)
        .post(`/api/v1/accounts/${ledgerAccountId}/transactions`)
        .send({
          type: 'debit',
          amount: '30.00',
          description: 'PRD debit 1',
          reference_id: 'prd-seq-03',
        });
      expect(d1.status).toBe(201);

      // 7. Debit 20.00 -> 100.00
      const d2 = await request(app)
        .post(`/api/v1/accounts/${ledgerAccountId}/transactions`)
        .send({
          type: 'debit',
          amount: '20.00',
          description: 'PRD debit 2',
          reference_id: 'prd-seq-04',
        });
      expect(d2.status).toBe(201);

      // 8. Verify final balance via API
      const finalBalResponse = await request(app).get(
        `/api/v1/accounts/${ledgerAccountId}/balance`
      );
      expect(finalBalResponse.status).toBe(200);
      expect(finalBalResponse.body.balance).toBe('100.00');

      // 9. Verify database balance column in accounts table
      const dbAccRes = await pool.query(
        'SELECT balance FROM accounts WHERE id = $1;',
        [ledgerAccountId]
      );
      expect(parseFloat(dbAccRes.rows[0].balance).toFixed(2)).toBe('100.00');

      // 10. Verify sum of all transaction records matches account balance exactly
      const dbSumRes = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0.00) AS ledger_sum,
           COUNT(*) AS total_count
         FROM transactions
         WHERE account_id = $1;`,
        [ledgerAccountId]
      );
      expect(parseFloat(dbSumRes.rows[0].ledger_sum).toFixed(2)).toBe('100.00');
      expect(parseInt(dbSumRes.rows[0].total_count, 10)).toBe(4);

      // 11. Verify transaction history endpoint returns exactly 4 items
      const historyResponse = await request(app).get(
        `/api/v1/accounts/${ledgerAccountId}/transactions`
      );
      expect(historyResponse.status).toBe(200);
      expect(historyResponse.body.total_records).toBe(4);
      expect(historyResponse.body.data.length).toBe(4);
    });
  });
});
