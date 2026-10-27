import fs from 'fs';
import path from 'path';
import { pool, closeDatabasePool } from '../../src/config/database';

/**
 * Executes database seed script and displays seeded accounts and reconciliation status.
 */
export async function runSeeds(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('🌱 Starting database seeding...');

    const seedFilePath = path.resolve(__dirname, 'seed.sql');
    if (!fs.existsSync(seedFilePath)) {
      throw new Error(`Seed file not found at: ${seedFilePath}`);
    }

    const sql = fs.readFileSync(seedFilePath, 'utf-8');
    await client.query(sql);

    // Fetch and display seeded accounts summary
    const accountsRes = await client.query<{
      id: string;
      name: string;
      balance: string;
      created_at: Date;
    }>(`
      SELECT id, name, balance, created_at
      FROM accounts
      WHERE id IN (
        'a0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000005',
        'a0000000-0000-0000-0000-000000000006'
      )
      ORDER BY id ASC;
    `);

    // Audit verification query to prove stored balance strictly equals transaction ledger sum
    const auditRes = await client.query<{
      id: string;
      stored_balance: string;
      ledger_sum: string;
    }>(`
      SELECT 
        a.id,
        a.balance AS stored_balance,
        COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0.00) AS ledger_sum
      FROM accounts a
      LEFT JOIN transactions t ON a.id = t.account_id
      GROUP BY a.id, a.balance
      ORDER BY a.id ASC;
    `);

    console.log('\n================================================================');
    console.log('                 LEDGERPRO SEEDED ACCOUNTS                      ');
    console.log('================================================================');
    for (const acc of accountsRes.rows) {
      const balanceNum = parseFloat(acc.balance);
      console.log(`• [${acc.id}]`);
      console.log(`  Name:    ${acc.name}`);
      console.log(`  Balance: $${balanceNum.toFixed(2)}`);
    }

    console.log('\n================================================================');
    console.log('             LEDGER AUDIT & RECONCILIATION CHECK                ');
    console.log('================================================================');
    let allReconciled = true;
    for (const row of auditRes.rows) {
      const stored = parseFloat(row.stored_balance);
      const ledger = parseFloat(row.ledger_sum);
      if (Math.abs(stored - ledger) > 0.001) {
        console.error(`❌ Mismatch on Account ${row.id}: Stored $${stored.toFixed(2)} vs Ledger $${ledger.toFixed(2)}`);
        allReconciled = false;
      }
    }

    if (allReconciled) {
      console.log('✅ Audit Passed: 100% of account balances match transaction ledger sums.');
      console.log('🎉 Database seeding completed successfully.');
    } else {
      throw new Error('Database seeding resulted in an audit balance mismatch!');
    }
  } finally {
    client.release();
  }
}

// If executed directly from CLI (e.g., npm run seed)
if (require.main === module) {
  runSeeds()
    .then(async () => {
      await closeDatabasePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed runner error:', err);
      await closeDatabasePool();
      process.exit(1);
    });
}
