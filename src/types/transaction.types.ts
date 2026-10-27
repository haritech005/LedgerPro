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

export interface TransactionHistoryQuery {
  type?: TransactionType;
  page: number;
  limit: number;
}

export interface PaginatedTransactions {
  account_id: string;
  page: number;
  limit: number;
  total_records: number;
  total_pages: number;
  data: Transaction[];
}
