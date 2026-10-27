import { pool } from '../../src/config/database';

/**
 * Safely cleans up test accounts and associated transactions in automated test suites.
 * Explicitly enables the session variable 'ledgerpro.allow_test_cleanup' to bypass
 * the immutable ledger deletion trigger during test teardown.
 */
export async function cleanupTestAccounts(
  accountIds: (string | undefined | null)[]
): Promise<void> {
  const validIds = accountIds.filter((id): id is string => Boolean(id));
  if (validIds.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("SET ledgerpro.allow_test_cleanup = 'true'");
    await client.query(
      'DELETE FROM transactions WHERE account_id = ANY($1::uuid[]);',
      [validIds]
    );
    await client.query(
      'DELETE FROM accounts WHERE id = ANY($1::uuid[]);',
      [validIds]
    );
  } finally {
    client.release();
  }
}
