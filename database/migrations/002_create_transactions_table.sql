-- Migration: 002_create_transactions_table.sql
-- Purpose: Create transactions table with immutability, reference uniqueness, and integrity constraints

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  type VARCHAR(10) NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  description VARCHAR(500) NOT NULL,
  reference_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_transactions_type CHECK (type IN ('credit', 'debit')),
  CONSTRAINT chk_transactions_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_transactions_description_not_empty CHECK (LENGTH(TRIM(description)) > 0),
  CONSTRAINT chk_transactions_reference_id_not_empty CHECK (LENGTH(TRIM(reference_id)) > 0),
  CONSTRAINT uq_transactions_account_reference UNIQUE (account_id, reference_id)
);

-- Indexes for efficient history lookups and chronologically sorted queries
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_created_at ON transactions (account_id, created_at DESC);
