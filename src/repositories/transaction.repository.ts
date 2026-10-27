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

  /**
   * Retrieves paginated transaction history with optional type filter.
   * Uses latest-first ordering by created_at DESC with deterministic secondary sort by id DESC.
   */
  async findHistory(
    accountId: string,
    options: { type?: TransactionType; page: number; limit: number },
    client?: PoolClient
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const { type, page, limit } = options;
    const offset = (page - 1) * limit;

    // Build parameterized count and select queries
    const countConditions: string[] = ['account_id = $1'];
    const countParams: any[] = [accountId];

    if (type) {
      countConditions.push('type = $2');
      countParams.push(type);
    }

    const countSql = `
      SELECT COUNT(*) AS total
      FROM transactions
      WHERE ${countConditions.join(' AND ')};
    `;

    const countResult = client
      ? await client.query(countSql, countParams)
      : await query(countSql, countParams);

    const total = parseInt(countResult.rows[0].total, 10);

    if (total === 0) {
      return { transactions: [], total: 0 };
    }

    const selectConditions: string[] = ['account_id = $1'];
    const selectParams: any[] = [accountId];

    if (type) {
      selectConditions.push('type = $2');
      selectParams.push(type);
    }

    const nextParamIndex = selectParams.length + 1;
    selectParams.push(limit, offset);

    const selectSql = `
      SELECT id, account_id, type, amount, description, reference_id, created_at
      FROM transactions
      WHERE ${selectConditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1};
    `;

    const selectResult = client
      ? await client.query(selectSql, selectParams)
      : await query(selectSql, selectParams);

    const transactions: Transaction[] = selectResult.rows.map((row) => ({
      id: row.id,
      account_id: row.account_id,
      type: row.type as TransactionType,
      amount: parseFloat(row.amount).toFixed(2),
      description: row.description,
      reference_id: row.reference_id,
      created_at: new Date(row.created_at).toISOString(),
    }));

    return { transactions, total };
  }
}

export const transactionRepository = new TransactionRepository();
