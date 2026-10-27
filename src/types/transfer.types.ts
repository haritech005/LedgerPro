export interface Transfer {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  amount: string;
  reference_id: string;
  description: string;
  debit_transaction_id: string;
  credit_transaction_id: string;
  created_at: string;
}

export interface CreateTransferDTO {
  source_account_id: string;
  destination_account_id: string;
  amount: string;
  reference_id: string;
  description: string;
}
