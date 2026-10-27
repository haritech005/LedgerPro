-- ==============================================================================
-- LedgerPro Database Seed Script
-- Safe, repeatable sample data for local development, verification, and testing.
-- All nonzero account balances are strictly derived from seeded transaction records.
-- ==============================================================================

BEGIN;

-- 1. Seed Accounts (ON CONFLICT DO UPDATE ensures idempotent repeatability)
INSERT INTO accounts (id, name, balance, created_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Alice Smith - Operating Account', 1350.00, NOW() - INTERVAL '7 days'),
  ('a0000000-0000-0000-0000-000000000002', 'Bob Jones - Savings Account', 2000.00, NOW() - INTERVAL '7 days'),
  ('a0000000-0000-0000-0000-000000000003', 'Charlie Brown - Payroll Account', 1000.00, NOW() - INTERVAL '7 days'),
  ('a0000000-0000-0000-0000-000000000004', 'Corporate Treasury Primary', 450000.00, NOW() - INTERVAL '14 days'),
  ('a0000000-0000-0000-0000-000000000005', 'Escrow Reserve Vault', 25000.00, NOW() - INTERVAL '5 days'),
  ('a0000000-0000-0000-0000-000000000006', 'Dormant Zero Balance Account', 0.00, NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  balance = EXCLUDED.balance;

-- 2. Seed Transaction Records (ON CONFLICT DO NOTHING ensures immutability safety)
INSERT INTO transactions (id, account_id, type, amount, description, reference_id, created_at)
VALUES
  -- Alice Smith Transactions (Initial: $1000 + $500 - $250 + $100 transfer = $1350)
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'credit', 1000.00, 'Initial operating capital deposit', 'SEED-ALICE-CR-001', NOW() - INTERVAL '5 days'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'credit', 500.00,  'Client invoice payment settlement', 'SEED-ALICE-CR-002', NOW() - INTERVAL '3 days'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'debit',  250.00,  'Cloud infrastructure hosting expense', 'SEED-ALICE-DR-001', NOW() - INTERVAL '1 day'),
  ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'credit', 100.00,  'Transfer from Charlie: Monthly consulting fee', 'SEED-TRF-001-credit', NOW() - INTERVAL '12 hours'),

  -- Bob Jones Transactions ($2500 - $300 - $200 = $2000)
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'credit', 2500.00, 'Direct deposit savings allocation', 'SEED-BOB-CR-001', NOW() - INTERVAL '6 days'),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'debit',  300.00,  'Utility and telecommunications bill', 'SEED-BOB-DR-001', NOW() - INTERVAL '4 days'),
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', 'debit',  200.00,  'Automated investment transfer', 'SEED-BOB-DR-002', NOW() - INTERVAL '2 days'),

  -- Charlie Brown Transactions ($1500 - $400 - $100 transfer = $1000)
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', 'credit', 1500.00, 'Retainer fee credit', 'SEED-CHARLIE-CR-001', NOW() - INTERVAL '7 days'),
  ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000003', 'debit',  400.00,  'Office equipment and supplies', 'SEED-CHARLIE-DR-001', NOW() - INTERVAL '5 days'),
  ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000003', 'debit',  100.00,  'Transfer to Alice: Monthly consulting fee', 'SEED-TRF-001-debit', NOW() - INTERVAL '12 hours'),

  -- Corporate Treasury Transactions ($500,000 - $50,000 = $450,000)
  ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000004', 'credit', 500000.00, 'Series funding treasury allocation', 'SEED-TREASURY-CR-001', NOW() - INTERVAL '10 days'),
  ('b0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000004', 'debit',  50000.00,  'Vendor bulk procurement disbursement', 'SEED-TREASURY-DR-001', NOW() - INTERVAL '3 days'),

  -- Escrow Reserve Transactions ($25,000)
  ('b0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000005', 'credit', 25000.00, 'Security escrow deposit', 'SEED-ESCROW-CR-001', NOW() - INTERVAL '2 days')
ON CONFLICT (account_id, reference_id) DO NOTHING;

-- 3. Seed Money Transfer Record (Charlie -> Alice $100.00)
INSERT INTO transfers (
  id,
  source_account_id,
  destination_account_id,
  amount,
  reference_id,
  description,
  debit_transaction_id,
  credit_transaction_id,
  created_at
)
VALUES
  (
    'c0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    100.00,
    'SEED-TRF-001',
    'Monthly consulting fee',
    'b0000000-0000-0000-0000-000000000009',
    'b0000000-0000-0000-0000-000000000010',
    NOW() - INTERVAL '12 hours'
  )
ON CONFLICT (reference_id) DO NOTHING;

-- 4. Reconcile Account Balances from Transaction Ledger to ensure 100% mathematical precision
UPDATE accounts a
SET
  balance = COALESCE(
    (SELECT SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END)
     FROM transactions t
     WHERE t.account_id = a.id),
    0.00
  )
WHERE a.id IN (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000006'
);

COMMIT;
