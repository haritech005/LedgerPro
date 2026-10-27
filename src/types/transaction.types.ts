export type TransactionType = 'credit' | 'debit';

export interface Transaction {
  id: string;
  account_id: string;
  type: TransactionType;
  amount: string; // Exact decimal representation (e.g. "100.00")
  description: string;
  reference_id: string;
  created_at: string; // ISO 8601 string
}

export interface CreateTransactionDTO {
  type: TransactionType;
  amount: number | string;
  description: string;
  reference_id: string;
}
