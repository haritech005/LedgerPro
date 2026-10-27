-- Baseline migration for LedgerPro
-- Ensures pgcrypto extension is available for UUID generation if needed in future phases
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
