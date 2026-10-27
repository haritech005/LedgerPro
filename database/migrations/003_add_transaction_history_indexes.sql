-- Migration: 003_add_transaction_history_indexes.sql
-- Purpose: Optimize transaction history retrieval with type filtering and chronologically sorted pagination

CREATE INDEX IF NOT EXISTS idx_transactions_history_filter
  ON transactions (account_id, type, created_at DESC, id DESC);
