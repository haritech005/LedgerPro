import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

export interface DatabaseHealthStatus {
  status: 'connected' | 'disconnected';
  latencyMs?: number;
  serverTime?: string;
  error?: string;
}

/**
 * Checks PostgreSQL connection status and measures response latency.
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealthStatus> {
  const startTime = Date.now();
  try {
    const res = await pool.query<{ connected: number; db_time: Date }>(
      'SELECT 1 AS connected, NOW() AS db_time;'
    );
    const latencyMs = Date.now() - startTime;
    return {
      status: 'connected',
      latencyMs,
      serverTime: res.rows[0]?.db_time ? new Date(res.rows[0].db_time).toISOString() : undefined,
    };
  } catch (error: any) {
    return {
      status: 'disconnected',
      error: error?.message || 'Failed to connect to database',
    };
  }
}

/**
 * Executes a SQL query with parameterization.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Obtains a dedicated client from the pool (for transactions).
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Closes the connection pool gracefully.
 */
export async function closeDatabasePool(): Promise<void> {
  await pool.end();
}
