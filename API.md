# LedgerPro — API Documentation

This document describes the API specifications, status codes, error handling conventions, and idempotency guarantees for LedgerPro.

**Base URL:** `/api/v1`

---

## 1. Idempotency & Duplicate Transaction Semantics

In financial systems, network retries, client timeouts, and concurrent requests can easily cause accidental double-charging or double-crediting if not handled with strict idempotency.

LedgerPro provides database-backed idempotency through account-scoped reference identifiers (`reference_id`).

### Key Idempotency Rules:
1. **Account-Scoped References:**
   - Every transaction submitted to an account must specify a unique `reference_id`.
   - The database enforces uniqueness with the constraint `uq_transactions_account_reference UNIQUE (account_id, reference_id)`.
   - The same `reference_id` may safely be used by different accounts (e.g., invoice `INV-2026-001` across different clients) without conflict.
2. **Duplicate Detection:**
   - If a request is received with a `reference_id` that has already been executed for that account, the system rejects it immediately with HTTP `409 Conflict`.
   - No second transaction record is written to the ledger.
   - The account balance is not changed.
   - The response includes the details of the original transaction so clients can reconcile state.
3. **Concurrency Safety:**
   - Even if two identical requests arrive simultaneously at the exact millisecond, database row-level locking (`SELECT ... FOR UPDATE`) serializes the account update and the unique constraint catches race conditions, ensuring only one request succeeds and the other receives a `409 Conflict`.
4. **Safe Client Retry Strategy:**
   - If a client experiences a network timeout or connection drop, it can safely retry the exact same request with the original `reference_id`.
   - If the first request had already committed before the network dropped, the retry receives `409 Conflict` containing the confirmation of the existing transaction.
   - If the first request never completed, the retry will succeed and execute the transaction normally.

---

## 2. API Endpoints

### 2.1 Health Check
**GET** `/api/v1/health`

Verifies that the server is alive and actively communicating with the PostgreSQL database.

#### Response (200 OK)
```json
{
  "status": "healthy",
  "timestamp": "2026-10-27T13:15:00.000Z",
  "uptime": 120.45,
  "services": {
    "database": {
      "status": "connected",
      "latencyMs": 14,
      "serverTime": "2026-10-27T13:15:00.000Z"
    }
  }
}
```

---

### 2.2 Account Creation
**POST** `/api/v1/accounts`

Creates a new account with a system-generated UUID and an initial balance of exactly zero.

#### Request Body
```json
{
  "name": "Jane Doe"
}
```

#### Constraints
- `name`: Required string, trimmed, non-empty, max 255 characters.
- System fields like `balance`, `id`, and `created_at` cannot be supplied by clients.

#### Response (201 Created)
```json
{
  "id": "3bf60359-cbc5-4366-bcf3-ed9752f437c9",
  "name": "Jane Doe",
  "balance": "0.00",
  "created_at": "2026-10-27T13:15:41.956Z"
}
```

---

### 2.3 Create Transaction
**POST** `/api/v1/accounts/:accountId/transactions`

Executes a credit or debit operation atomically, updates account balance, and appends an immutable transaction record to the ledger.

#### Request Body
```json
{
  "type": "credit",
  "amount": 500.00,
  "description": "Salary direct deposit",
  "reference_id": "SALARY-2026-10-01"
}
```

#### Validation Rules
- `:accountId`: Must be a valid UUID.
- `type`: Must be strictly `'credit'` or `'debit'`.
- `amount`: Must be a positive number or decimal string (> 0) with at most 2 decimal places. Max limit: 1,000,000,000.
- `description`: Required string, non-empty, max 500 characters.
- `reference_id`: Required string, unique per account, max 255 characters.

#### Response (201 Created)
```json
{
  "id": "2a39b1b6-25a4-40d0-9c64-c46db12a684f",
  "account_id": "3bf60359-cbc5-4366-bcf3-ed9752f437c9",
  "type": "credit",
  "amount": "500.00",
  "description": "Salary direct deposit",
  "reference_id": "SALARY-2026-10-01",
  "created_at": "2026-10-27T13:15:41.992Z"
}
```

#### Duplicate Reference Response (409 Conflict)
```json
{
  "error": {
    "code": "DUPLICATE_TRANSACTION_REFERENCE",
    "message": "A transaction with reference ID 'SALARY-2026-10-01' has already been processed for this account.",
    "details": {
      "reference_id": "SALARY-2026-10-01",
      "existing_transaction_id": "2a39b1b6-25a4-40d0-9c64-c46db12a684f",
      "type": "credit",
      "amount": "500.00",
      "created_at": "2026-10-27T13:15:41.992Z"
    }
  }
}
```

#### Insufficient Balance Response (422 Unprocessable Content)
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "The account does not have sufficient funds."
  }
}
```

---

### 2.4 Retrieve Account Balance
**GET** `/api/v1/accounts/:accountId/balance`

Retrieves the current balance for an existing account.

#### URL Parameters
- `:accountId`: Valid UUID of the target account.

#### Response (200 OK)
```json
{
  "account_id": "3bf60359-cbc5-4366-bcf3-ed9752f437c9",
  "balance": "350.00"
}
```

#### Not Found Response (404 Not Found)
```json
{
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "Account with ID '00000000-0000-0000-0000-000000000000' was not found."
  }
}
```

#### Invalid Parameter Response (400 Bad Request)
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid account ID format. Must be a valid UUID."
  }
}
```

---

## 3. Standard HTTP Status Codes

| Code | Meaning | When Used |
|---|---|---|
| `200 OK` | Request succeeded | Successful queries, health checks |
| `201 Created` | Resource created | Successful account or transaction creation |
| `400 Bad Request` | Validation failure | Missing fields, negative amounts, precision > 2 decimals, invalid types |
| `404 Not Found` | Resource not found | Nonexistent account ID |
| `409 Conflict` | Business conflict | Duplicate `reference_id` submission for the same account |
| `422 Unprocessable` | Business rule failure | Insufficient balance on debit |
| `500 Internal Error` | Server error | Unexpected database or internal failure |
