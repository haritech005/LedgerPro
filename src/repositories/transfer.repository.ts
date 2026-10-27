import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Transfer } from '../types/transfer.types';

export interface InsertTransferData {
  source_account_id: string;
  destination_account_id: string;
  amount: string;
  reference_id: string;
  description: string;
  debit_transaction_id: string;
  credit_transaction_id: string;
}

export class TransferRepository {
  /**
   * Inserts an immutable transfer record linking source debit and destination credit.
   */
  async create(data: InsertTransferData, client: PoolClient): Promise<Transfer> {
    const sql = `
      INSERT INTO transfers (
        source_account_id,
        destination_account_id,
        amount,
        reference_id,
        description,
        debit_transaction_id,
        credit_transaction_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        source_account_id,
        destination_account_id,
        amount,
        reference_id,
        description,
        debit_transaction_id,
        credit_transaction_id,
        created_at;
    `;
    const params = [
      data.source_account_id,
      data.destination_account_id,
      data.amount,
      data.reference_id,
      data.description,
      data.debit_transaction_id,
      data.credit_transaction_id,
    ];

    const result = await client.query(sql, params);
    const row = result.rows[0];

    return {
      id: row.id,
      source_account_id: row.source_account_id,
      destination_account_id: row.destination_account_id,
      amount: parseFloat(row.amount).toFixed(2),
      reference_id: row.reference_id,
      description: row.description,
      debit_transaction_id: row.debit_transaction_id,
      credit_transaction_id: row.credit_transaction_id,
      created_at: new Date(row.created_at).toISOString(),
    };
  }

  /**
   * Finds a transfer record by client transfer reference ID.
   */
  async findByReference(
    referenceId: string,
    client?: PoolClient
  ): Promise<Transfer | null> {
    const sql = `
      SELECT
        id,
        source_account_id,
        destination_account_id,
        amount,
        reference_id,
        description,
        debit_transaction_id,
        credit_transaction_id,
        created_at
      FROM transfers
      WHERE reference_id = $1;
    `;
    const params = [referenceId];

    const result = client
      ? await client.query(sql, params)
      : await query(sql, params);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      source_account_id: row.source_account_id,
      destination_account_id: row.destination_account_id,
      amount: parseFloat(row.amount).toFixed(2),
      reference_id: row.reference_id,
      description: row.description,
      debit_transaction_id: row.debit_transaction_id,
      credit_transaction_id: row.credit_transaction_id,
      created_at: new Date(row.created_at).toISOString(),
    };
  }
}

export const transferRepository = new TransferRepository();
