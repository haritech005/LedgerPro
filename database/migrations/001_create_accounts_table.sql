-- Migration: 001_create_accounts_table.sql
-- Purpose: Create accounts table with strict constraints for financial integrity

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_accounts_balance_non_negative CHECK (balance >= 0),
  CONSTRAINT chk_accounts_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- Index on created_at for chronological ordering if needed
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts (created_at DESC);
