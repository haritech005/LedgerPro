-- Migration: 004_enforce_transaction_immutability.sql
-- Purpose: Enforce database-level ledger immutability on transactions table
-- Description: Prevents any UPDATE or TRUNCATE operations, and prevents DELETE operations
--              unless explicitly authorized by setting 'ledgerpro.allow_test_cleanup = true' in session.

CREATE OR REPLACE FUNCTION prevent_transaction_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Transaction records are immutable: UPDATE operations are strictly prohibited'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        -- Allow automated test suite or administrative maintenance when explicitly authorized in session
        IF current_setting('ledgerpro.allow_test_cleanup', true) = 'true' THEN
            RETURN OLD;
        END IF;

        RAISE EXCEPTION 'Transaction records are immutable: DELETE operations are strictly prohibited'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_transaction_update_delete ON transactions;

CREATE TRIGGER trg_prevent_transaction_update_delete
BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW
EXECUTE FUNCTION prevent_transaction_mutation();

-- Guard against TRUNCATE operations
CREATE OR REPLACE FUNCTION prevent_transaction_truncate()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('ledgerpro.allow_test_cleanup', true) = 'true' THEN
        RETURN NULL;
    END IF;

    RAISE EXCEPTION 'Transaction records are immutable: TRUNCATE operations are strictly prohibited'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_transaction_truncate ON transactions;

CREATE TRIGGER trg_prevent_transaction_truncate
BEFORE TRUNCATE ON transactions
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_transaction_truncate();
