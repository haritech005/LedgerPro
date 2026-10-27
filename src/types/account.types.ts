export interface Account {
  id: string;
  name: string;
  balance: string; // Exact decimal representation (e.g. "0.00")
  created_at: string; // ISO 8601 string
}

export interface CreateAccountDTO {
  name: string;
}
