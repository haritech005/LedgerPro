import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Transaction, TransactionType } from '../types/transaction.types';

export interface InsertTransactionData {
  account_id: string;
  type: TransactionType;
  amount: string;
  description: string;
  reference_id: string;
}

export class TransactionRepository {
  /**
   * Inserts an immutable transaction record into the database.
   * Can be executed with a dedicated transaction client for atomicity.
   */
  async create(data: InsertTransactionData, client?: PoolClient): Promise<Transaction> {
    const sql = `
      INSERT INTO transactions (account_id, type, amount, description, reference_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, account_id, type, amount, description, reference_id, created_at;
    `;
    const params = [
      data.account_id,
      data.type,
      data.amount,
      data.description,
      data.reference_id,
    ];

    const result = client
      ? await client.query(sql, params)
      : await query(sql, params);

    const row = result.rows[0];
    return {
      id: row.id,
      account_id: row.account_id,
      type: row.type as TransactionType,
      amount: parseFloat(row.amount).toFixed(2),
      description: row.description,
      reference_id: row.reference_id,
      created_at: new Date(row.created_at).toISOString(),
    };
  }

  /**
   * Finds a transaction by account ID and client reference ID.
   */
  async findByAccountAndReference(
    accountId: string,
    referenceId: string,
    client?: PoolClient
  ): Promise<Transaction | null> {
    const sql = `
      SELECT id, account_id, type, amount, description, reference_id, created_at
      FROM transactions
      WHERE account_id = $1 AND reference_id = $2;
    `;
    const params = [accountId, referenceId];

    const result = client
      ? await client.query(sql, params)
      : await query(sql, params);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      account_id: row.account_id,
      type: row.type as TransactionType,
      amount: parseFloat(row.amount).toFixed(2),
      description: row.description,
      reference_id: row.reference_id,
      created_at: new Date(row.created_at).toISOString(),
    };
  }
}

export const transactionRepository = new TransactionRepository();
