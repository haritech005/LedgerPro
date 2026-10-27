import { PoolClient } from 'pg';
import { pool, query } from '../config/database';
import { Account } from '../types/account.types';

export class AccountRepository {
  /**
   * Creates a new account with a zero balance and system-generated ID and timestamp.
   */
  async create(name: string, client?: PoolClient): Promise<Account> {
    const sql = `
      INSERT INTO accounts (name, balance)
      VALUES ($1, 0.00)
      RETURNING id, name, balance, created_at;
    `;
    const params = [name];

    const result = client
      ? await client.query(sql, params)
      : await query(sql, params);

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      balance: parseFloat(row.balance).toFixed(2), // formatted exact decimal string "0.00"
      created_at: new Date(row.created_at).toISOString(),
    };
  }

  /**
   * Finds an account by its unique identifier.
   */
  async findById(id: string, client?: PoolClient): Promise<Account | null> {
    const sql = `
      SELECT id, name, balance, created_at
      FROM accounts
      WHERE id = $1;
    `;
    const params = [id];

    const result = client
      ? await client.query(sql, params)
      : await query(sql, params);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      balance: parseFloat(row.balance).toFixed(2),
      created_at: new Date(row.created_at).toISOString(),
    };
  }
}

export const accountRepository = new AccountRepository();
