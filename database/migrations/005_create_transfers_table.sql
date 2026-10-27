-- Migration: 005_create_transfers_table.sql
-- Purpose: Create transfers table for atomic money transfers between accounts

CREATE TABLE IF NOT EXISTS transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  destination_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(15, 2) NOT NULL,
  reference_id VARCHAR(255) NOT NULL UNIQUE,
  description VARCHAR(500) NOT NULL,
  debit_transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  credit_transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_transfers_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_transfers_reference_not_empty CHECK (LENGTH(TRIM(reference_id)) > 0),
  CONSTRAINT chk_transfers_description_not_empty CHECK (LENGTH(TRIM(description)) > 0),
  CONSTRAINT chk_transfers_different_accounts CHECK (source_account_id <> destination_account_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_source_account ON transfers (source_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_destination_account ON transfers (destination_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_reference_id ON transfers (reference_id);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON transfers (created_at DESC);

-- Apply ledger immutability trigger to transfers table
DROP TRIGGER IF EXISTS trg_prevent_transfers_update_delete ON transfers;

CREATE TRIGGER trg_prevent_transfers_update_delete
BEFORE UPDATE OR DELETE ON transfers
FOR EACH ROW
EXECUTE FUNCTION prevent_transaction_mutation();
