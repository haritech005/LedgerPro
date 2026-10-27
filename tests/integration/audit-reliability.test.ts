import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { pool, closeDatabasePool } from '../../src/config/database';
import { cleanupTestAccounts } from '../helpers/db-cleanup';

describe('Advanced Reliability, Audit Verification, and Final Integrity (Phase 11)', () => {
  const createdAccountIds: string[] = [];

  afterAll(async () => {
    await cleanupTestAccounts(createdAccountIds);
    await closeDatabasePool();
  });

  describe('11.1 Idempotent Transaction Processing', () => {
    it('should handle simultaneous duplicate credit requests safely: exactly 1 succeeds, 1 returns 409', async () => {
      const accRes = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Idempotency Credit Test' });
      const accountId = accRes.body.id;
      createdAccountIds.push(accountId);

      const refId = `phase11-idem-cr-${Date.now()}`;
      const payload = {
        type: 'credit',
        amount: '150.00',
        description: 'Idempotent simultaneous credit test',
        reference_id: refId,
      };

      // Fire 2 simultaneous requests with identical reference_id
      const [res1, res2] = await Promise.all([
        request(app).post(`/api/v1/accounts/${accountId}/transactions`).send(payload),
        request(app).post(`/api/v1/accounts/${accountId}/transactions`).send(payload),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const successRes = res1.status === 201 ? res1 : res2;
      const conflictRes = res1.status === 409 ? res1 : res2;

      expect(successRes.body.reference_id).toBe(refId);
      expect(conflictRes.body.error.code).toBe('DUPLICATE_TRANSACTION_REFERENCE');

      // Verify only ONE transaction record exists in DB
      const dbTxRes = await pool.query(
        'SELECT COUNT(*) FROM transactions WHERE account_id = $1 AND reference_id = $2;',
        [accountId, refId]
      );
      expect(parseInt(dbTxRes.rows[0].count, 10)).toBe(1);

      // Verify account balance was credited only ONCE
      const balRes = await request(app).get(`/api/v1/accounts/${accountId}/balance`);
      expect(balRes.body.balance).toBe('150.00');
    });

    it('should handle simultaneous duplicate debit requests safely: exactly 1 succeeds, 1 returns 409', async () => {
      const accRes = await request(app)
        .post('/api/v1/accounts')
        .send({ name: 'Idempotency Debit Test' });
      const accountId = accRes.body.id;
      createdAccountIds.push(accountId);

      // Seed funds
      await request(app)
        .post(`/api/v1/accounts/${accountId}/transactions`)
        .send({
          type: 'credit',
          amount: '300.00',
          description: 'Initial funds for debit test',
          reference_id: `seed-funds-${Date.now()}`,
        });

      const refId = `phase11-idem-dr-${Date.now()}`;
      const debitPayload = {
        type: 'debit',
        amount: '100.00',
        description: 'Idempotent simultaneous debit test',
        reference_id: refId,
      };

      const [res1, res2] = await Promise.all([
        request(app).post(`/api/v1/accounts/${accountId}/transactions`).send(debitPayload),
        request(app).post(`/api/v1/accounts/${accountId}/transactions`).send(debitPayload),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      // Exactly 1 debit transaction in DB
      const dbTxRes = await pool.query(
        'SELECT COUNT(*) FROM transactions WHERE account_id = $1 AND reference_id = $2;',
        [accountId, refId]
      );
      expect(parseInt(dbTxRes.rows[0].count, 10)).toBe(1);

      // Balance was debited only once: 300 - 100 = 200
      const balRes = await request(app).get(`/api/v1/accounts/${accountId}/balance`);
      expect(balRes.body.balance).toBe('200.00');
    });

    it('should handle simultaneous duplicate transfer requests safely: exactly 1 succeeds, 1 returns 409', async () => {
      const [accA, accB] = await Promise.all([
        request(app).post('/api/v1/accounts').send({ name: 'Idempotent Transfer Source' }),
        request(app).post('/api/v1/accounts').send({ name: 'Idempotent Transfer Dest' }),
      ]);
      const srcId = accA.body.id;
      const dstId = accB.body.id;
      createdAccountIds.push(srcId, dstId);

      // Fund source account
      await request(app)
        .post(`/api/v1/accounts/${srcId}/transactions`)
        .send({
          type: 'credit',
          amount: '500.00',
          description: 'Seed for transfer idempotency',
          reference_id: `seed-xfer-fund-${Date.now()}`,
        });

      const refId = `phase11-trf-idem-${Date.now()}`;
      const transferPayload = {
        source_account_id: srcId,
        destination_account_id: dstId,
        amount: '120.00',
        description: 'Idempotent transfer test',
        reference_id: refId,
      };

      const [res1, res2] = await Promise.all([
        request(app).post('/api/v1/transfers').send(transferPayload),
        request(app).post('/api/v1/transfers').send(transferPayload),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const conflictRes = res1.status === 409 ? res1 : res2;
      expect(conflictRes.body.error.code).toBe('DUPLICATE_TRANSACTION_REFERENCE');

      // Verify only 1 transfer record in transfers table
      const dbTrfRes = await pool.query(
        'SELECT COUNT(*) FROM transfers WHERE reference_id = $1;',
        [refId]
      );
      expect(parseInt(dbTrfRes.rows[0].count, 10)).toBe(1);

      // Verify source balance: 500 - 120 = 380, dest balance: 120
      const [srcBal, dstBal] = await Promise.all([
        request(app).get(`/api/v1/accounts/${srcId}/balance`),
        request(app).get(`/api/v1/accounts/${dstId}/balance`),
      ]);
      expect(srcBal.body.balance).toBe('380.00');
      expect(dstBal.body.balance).toBe('120.00');
    });
  });

  describe('11.2 Immutable Ledger Verification', () => {
    it('should strictly prohibit direct SQL UPDATE on transactions table', async () => {
      const acc = await request(app).post('/api/v1/accounts').send({ name: 'Immutability Audit' });
      createdAccountIds.push(acc.body.id);

      const txRes = await request(app)
        .post(`/api/v1/accounts/${acc.body.id}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'Original credit transaction',
          reference_id: `immut-cr-${Date.now()}`,
        });

      const txId = txRes.body.id;

      await expect(
        pool.query('UPDATE transactions SET amount = 9999.00 WHERE id = $1;', [txId])
      ).rejects.toThrow(/Transaction records are immutable/i);
    });

    it('should strictly prohibit direct SQL DELETE on transactions table', async () => {
      const acc = await request(app).post('/api/v1/accounts').send({ name: 'Delete Guard Audit' });
      createdAccountIds.push(acc.body.id);

      const txRes = await request(app)
        .post(`/api/v1/accounts/${acc.body.id}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'Protected transaction',
          reference_id: `immut-del-${Date.now()}`,
        });

      const txId = txRes.body.id;

      await expect(
        pool.query('DELETE FROM transactions WHERE id = $1;', [txId])
      ).rejects.toThrow(/Transaction records are immutable/i);
    });

    it('should strictly prohibit direct SQL UPDATE and DELETE on transfers table', async () => {
      const [accA, accB] = await Promise.all([
        request(app).post('/api/v1/accounts').send({ name: 'Transfer Audit A' }),
        request(app).post('/api/v1/accounts').send({ name: 'Transfer Audit B' }),
      ]);
      createdAccountIds.push(accA.body.id, accB.body.id);

      await request(app)
        .post(`/api/v1/accounts/${accA.body.id}/transactions`)
        .send({
          type: 'credit',
          amount: '200.00',
          description: 'Fund account',
          reference_id: `fund-${Date.now()}`,
        });

      const trfRes = await request(app)
        .post('/api/v1/transfers')
        .send({
          source_account_id: accA.body.id,
          destination_account_id: accB.body.id,
          amount: '50.00',
          description: 'Transfer to protect',
          reference_id: `trf-audit-${Date.now()}`,
        });

      const trfId = trfRes.body.id;

      await expect(
        pool.query('UPDATE transfers SET amount = 1000.00 WHERE id = $1;', [trfId])
      ).rejects.toThrow(/Transaction records are immutable/i);

      await expect(
        pool.query('DELETE FROM transfers WHERE id = $1;', [trfId])
      ).rejects.toThrow(/Transaction records are immutable/i);
    });

    it('should return HTTP 405 METHOD_NOT_ALLOWED for mutation methods on transaction and transfer routes', async () => {
      const dummyId = 'a0000000-0000-0000-0000-000000000001';

      // PUT /api/v1/accounts/:id/transactions
      const putTx = await request(app).put(`/api/v1/accounts/${dummyId}/transactions`);
      expect(putTx.status).toBe(405);
      expect(putTx.body.error.code).toBe('METHOD_NOT_ALLOWED');

      // DELETE /api/v1/accounts/:id/transactions
      const delTx = await request(app).delete(`/api/v1/accounts/${dummyId}/transactions`);
      expect(delTx.status).toBe(405);
      expect(delTx.body.error.code).toBe('METHOD_NOT_ALLOWED');

      // PUT /api/v1/transfers
      const putTrf = await request(app).put('/api/v1/transfers');
      expect(putTrf.status).toBe(405);
      expect(putTrf.body.error.code).toBe('METHOD_NOT_ALLOWED');

      // DELETE /api/v1/transfers
      const delTrf = await request(app).delete('/api/v1/transfers');
      expect(delTrf.status).toBe(405);
      expect(delTrf.body.error.code).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('11.3 Concurrent Transaction Safety', () => {
    it('should prevent overdraft during simultaneous competing debit requests (Race Condition)', async () => {
      // Account created with exactly ₹100.00
      const acc = await request(app).post('/api/v1/accounts').send({ name: 'Overdraft Race Account' });
      const accountId = acc.body.id;
      createdAccountIds.push(accountId);

      await request(app)
        .post(`/api/v1/accounts/${accountId}/transactions`)
        .send({
          type: 'credit',
          amount: '100.00',
          description: 'Initial funding',
          reference_id: `race-fund-${Date.now()}`,
        });

      // Two simultaneous debit requests of ₹80.00 each
      const [res1, res2] = await Promise.all([
        request(app).post(`/api/v1/accounts/${accountId}/transactions`).send({
          type: 'debit',
          amount: '80.00',
          description: 'Debit A of 80',
          reference_id: `race-dr-A-${Date.now()}`,
        }),
        request(app).post(`/api/v1/accounts/${accountId}/transactions`).send({
          type: 'debit',
          amount: '80.00',
          description: 'Debit B of 80',
          reference_id: `race-dr-B-${Date.now()}`,
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one succeeds (201), the other fails with 422 INSUFFICIENT_FUNDS
      expect(statuses).toEqual([201, 422]);

      const failedRes = res1.status === 422 ? res1 : res2;
      expect(failedRes.body.error.code).toBe('INSUFFICIENT_BALANCE');

      // Account balance must be exactly ₹20.00 (100 - 80), NEVER negative
      const balRes = await request(app).get(`/api/v1/accounts/${accountId}/balance`);
      expect(balRes.body.balance).toBe('20.00');

      // Check database constraint directly
      const dbAcc = await pool.query('SELECT balance FROM accounts WHERE id = $1;', [accountId]);
      expect(parseFloat(dbAcc.rows[0].balance)).toBe(20.00);
    });

    it('should correctly reconcile balance under 10 concurrent mixed credits and debits', async () => {
      const acc = await request(app).post('/api/v1/accounts').send({ name: 'Mixed Concurrency Account' });
      const accountId = acc.body.id;
      createdAccountIds.push(accountId);

      // Seed account with ₹500.00
      await request(app)
        .post(`/api/v1/accounts/${accountId}/transactions`)
        .send({
          type: 'credit',
          amount: '500.00',
          description: 'Seed for mixed concurrency',
          reference_id: `seed-mixed-${Date.now()}`,
        });

      // 5 concurrent credits of ₹50.00 (+₹250.00)
      // 5 concurrent debits of ₹30.00 (-₹150.00)
      // Net expected balance: 500 + 250 - 150 = ₹600.00
      const operations = [
        ...Array.from({ length: 5 }, (_, i) => ({
          type: 'credit',
          amount: '50.00',
          description: `Concurrent credit ${i}`,
          reference_id: `conc-cr-${i}-${Date.now()}`,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          type: 'debit',
          amount: '30.00',
          description: `Concurrent debit ${i}`,
          reference_id: `conc-dr-${i}-${Date.now()}`,
        })),
      ];

      // Shuffle operations to maximize concurrency interleaving
      const shuffled = operations.sort(() => Math.random() - 0.5);

      const responses = await Promise.all(
        shuffled.map((op) =>
          request(app).post(`/api/v1/accounts/${accountId}/transactions`).send(op)
        )
      );

      // All 10 operations must succeed with 201
      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      // Check balance via API
      const balRes = await request(app).get(`/api/v1/accounts/${accountId}/balance`);
      expect(balRes.body.balance).toBe('600.00');

      // Verify audit sum matches stored balance
      const auditRes = await pool.query(
        `SELECT 
           a.balance AS stored,
           COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0) AS calculated
         FROM accounts a
         JOIN transactions t ON a.id = t.account_id
         WHERE a.id = $1
         GROUP BY a.balance;`,
        [accountId]
      );
      expect(parseFloat(auditRes.rows[0].stored)).toBe(600.00);
      expect(parseFloat(auditRes.rows[0].calculated)).toBe(600.00);
    });

    it('should handle multi-way concurrent transfers among 3 accounts without deadlock or money leakage', async () => {
      const [accA, accB, accC] = await Promise.all([
        request(app).post('/api/v1/accounts').send({ name: 'Deadlock Test Acc A' }),
        request(app).post('/api/v1/accounts').send({ name: 'Deadlock Test Acc B' }),
        request(app).post('/api/v1/accounts').send({ name: 'Deadlock Test Acc C' }),
      ]);
      const idA = accA.body.id;
      const idB = accB.body.id;
      const idC = accC.body.id;
      createdAccountIds.push(idA, idB, idC);

      // Fund each account with ₹1,000.00 (Total in system = ₹3,000.00)
      await Promise.all([
        request(app).post(`/api/v1/accounts/${idA}/transactions`).send({
          type: 'credit',
          amount: '1000.00',
          description: 'Fund A',
          reference_id: `fund-A-${Date.now()}`,
        }),
        request(app).post(`/api/v1/accounts/${idB}/transactions`).send({
          type: 'credit',
          amount: '1000.00',
          description: 'Fund B',
          reference_id: `fund-B-${Date.now()}`,
        }),
        request(app).post(`/api/v1/accounts/${idC}/transactions`).send({
          type: 'credit',
          amount: '1000.00',
          description: 'Fund C',
          reference_id: `fund-C-${Date.now()}`,
        }),
      ]);

      // 6 concurrent transfers executing simultaneously across all three accounts in circular and reciprocal patterns:
      // A -> B: 100.00
      // B -> C: 150.00
      // C -> A: 200.00
      // B -> A: 50.00
      // C -> B: 75.00
      // A -> C: 125.00
      const transferSpecs = [
        { src: idA, dst: idB, amt: '100.00', ref: `deadlock-ab-${Date.now()}` },
        { src: idB, dst: idC, amt: '150.00', ref: `deadlock-bc-${Date.now()}` },
        { src: idC, dst: idA, amt: '200.00', ref: `deadlock-ca-${Date.now()}` },
        { src: idB, dst: idA, amt: '50.00',  ref: `deadlock-ba-${Date.now()}` },
        { src: idC, dst: idB, amt: '75.00',  ref: `deadlock-cb-${Date.now()}` },
        { src: idA, dst: idC, amt: '125.00', ref: `deadlock-ac-${Date.now()}` },
      ];

      const responses = await Promise.all(
        transferSpecs.map((spec) =>
          request(app).post('/api/v1/transfers').send({
            source_account_id: spec.src,
            destination_account_id: spec.dst,
            amount: spec.amt,
            description: `Transfer ${spec.ref}`,
            reference_id: spec.ref,
          })
        )
      );

      // Every transfer must succeed with 201 Created — zero deadlocks
      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      // Check balance conservation:
      // A: 1000 - 100 (to B) + 200 (from C) + 50 (from B) - 125 (to C) = 1025.00
      // B: 1000 + 100 (from A) - 150 (to C) - 50 (to A) + 75 (from C) = 975.00
      // C: 1000 + 150 (from B) - 200 (to A) - 75 (to B) + 125 (from A) = 1000.00
      // Total money in system = 1025 + 975 + 1000 = 3000.00 (conservation of funds)
      const [balA, balB, balC] = await Promise.all([
        request(app).get(`/api/v1/accounts/${idA}/balance`),
        request(app).get(`/api/v1/accounts/${idB}/balance`),
        request(app).get(`/api/v1/accounts/${idC}/balance`),
      ]);

      expect(balA.body.balance).toBe('1025.00');
      expect(balB.body.balance).toBe('975.00');
      expect(balC.body.balance).toBe('1000.00');

      const totalBalance =
        parseFloat(balA.body.balance) +
        parseFloat(balB.body.balance) +
        parseFloat(balC.body.balance);
      expect(totalBalance).toBe(3000.00);
    });
  });

  describe('11.4 Full Ledger Audit Reconciliation', () => {
    it('should mathematically verify that all active accounts in the ledger reconcile with sum of transactions', async () => {
      const auditRes = await pool.query<{
        id: string;
        stored_balance: string;
        calculated_balance: string;
      }>(`
        SELECT 
          a.id,
          a.balance AS stored_balance,
          COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0.00) AS calculated_balance
        FROM accounts a
        LEFT JOIN transactions t ON a.id = t.account_id
        GROUP BY a.id, a.balance;
      `);

      expect(auditRes.rows.length).toBeGreaterThan(0);

      for (const row of auditRes.rows) {
        const stored = parseFloat(row.stored_balance);
        const calculated = parseFloat(row.calculated_balance);
        expect(Math.abs(stored - calculated)).toBeLessThanOrEqual(0.001);
      }
    });
  });
});
