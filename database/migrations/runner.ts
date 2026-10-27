import fs from 'fs';
import path from 'path';
import { pool, closeDatabasePool } from '../../src/config/database';

/**
 * Lightweight migration runner that tracks applied migrations in PostgreSQL.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('🚀 Running database migrations...');

    // Ensure schema_migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Fetch already applied migrations
    const res = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY id ASC;'
    );
    const appliedMigrations = new Set(res.rows.map((row) => row.name));

    // Read migration directory
    const migrationsDir = path.resolve(__dirname);
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    let appliedCount = 0;

    for (const file of files) {
      if (appliedMigrations.has(file)) {
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      // Execute migration inside a transaction
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1);',
          [file]
        );
        await client.query('COMMIT');
        console.log(`✅ Applied migration: ${file}`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Migration failed: ${file}`, err);
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log('✨ No pending migrations. Database schema is up to date.');
    } else {
      console.log(`🎉 Successfully applied ${appliedCount} migration(s).`);
    }
  } finally {
    client.release();
  }
}

// If executed directly from CLI (e.g., npm run migrate)
if (require.main === module) {
  runMigrations()
    .then(async () => {
      await closeDatabasePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration runner error:', err);
      await closeDatabasePool();
      process.exit(1);
    });
}
