# LedgerPro — System Assumptions & Engineering Decisions

This document details the architectural assumptions, domain invariants, technical decisions, and operational boundaries governing the LedgerPro financial transaction ledger system.

---

## 1. Identifier Generation

- **Standard**: Universally Unique Identifiers Version 4 (UUID v4) are utilized across all primary and foreign keys (`accounts.id`, `transactions.id`, `transfers.id`).
- **Generation Layer**: PostgreSQL `gen_random_uuid()` generates default UUIDs on insert, ensuring database-layer autogeneration while supporting deterministic UUID insertion for idempotent seeding.
- **Client Guarantees**: Clients never need to generate entity IDs; returned IDs are cryptographically strong, non-sequential, and prevent enumeration attacks.
- **Reference IDs**: Client-provided `reference_id` strings represent external idempotency tokens (e.g., checkout session IDs, banking rails transfer references). They are treated as case-sensitive strings with length between 1 and 255 characters.

---

## 2. Monetary Precision and Supported Limits

- **Internal Storage**: All monetary amounts are stored in PostgreSQL as `NUMERIC(15, 2)` with a strict two-decimal-place constraint and non-negative/positive check constraints (`CHECK (balance >= 0)`, `CHECK (amount > 0)`).
- **In-Memory Calculations**: JavaScript floating-point arithmetic is strictly avoided for all accounting logic. In-flight operations convert amounts into signed BigInt cents (`1.00` = `100n` cents), perform integer addition/subtraction, and format back to exact two-decimal string representations.
- **Maximum Supported Transaction**: The maximum single transaction or balance limit is set to `$1,000,000,000.00` (1 billion currency units / `100,000,000,000` cents) to avoid integer overflow and maintain financial safety margins.
- **Minimum Supported Unit**: `$0.01` (1 cent). Sub-cent currencies (e.g., fractional gas fees, micro-cents) are intentionally excluded.
- **Currency Homogeneity**: The system operates as a single-currency ledger (e.g., USD/INR default). Multi-currency conversions and FX rates are out of scope.

---

## 3. Balance Maintenance Strategy

- **Dual-Model Approach (Denormalized Cache with Immutable Audit Source)**:
  - Account balances are stored directly in `accounts.balance` for fast $O(1)$ balance inquiries and low-latency atomic balance checks.
  - Every single change to an account's balance MUST be accompanied by an immutable row in the `transactions` table inserted within the exact same PostgreSQL database transaction (`BEGIN ... COMMIT`).
  - Account balances can always be mathematically proven and audited via:
    ```sql
    SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0.00)
    FROM transactions WHERE account_id = $1;
    ```
- **Invariant**: Under zero circumstances can a balance change occur without an audit ledger transaction, or vice-versa. If either fails, the transaction is completely aborted via database `ROLLBACK`.

---

## 4. Duplicate Reference Semantics (Idempotency)

- **Account-Level Scope for Credit/Debit**:
  - The uniqueness constraint `uq_transactions_account_reference UNIQUE (account_id, reference_id)` enforces idempotency on a per-account basis.
  - Re-submitting an identical `reference_id` to the same account is rejected with `HTTP 409 Conflict` and error code `DUPLICATE_TRANSACTION_REFERENCE`.
  - Independent accounts may receive transactions with identical reference IDs without conflict (e.g., independent payroll batches across distinct entities).
- **Concurrency Protection**:
  - Idempotency is not checked by a pre-insert read alone (which is vulnerable to race conditions).
  - The PostgreSQL unique constraint guarantees that even under simultaneous concurrent duplicate requests (`Promise.all`), exactly one insert succeeds and all duplicates are caught by error code `23505` and converted to `HTTP 409 Conflict`.

---

## 5. Transfer Reference Semantics

- **Global Scope for Transfers**:
  - `transfers.reference_id` has a table-wide `UNIQUE` constraint. A transfer reference ID can only ever be used once across the entire platform.
- **Two-Legged Coordinated Ledger Entries**:
  - A money transfer creates exactly three records in a single database transaction:
    1. One debit transaction row on the source account (`reference_id = '{transfer_ref}-debit'`).
    2. One credit transaction row on the destination account (`reference_id = '{transfer_ref}-credit'`).
    3. One master transfer row linking source, destination, amount, and both transaction IDs.
- **Atomicity**:
  - If either leg fails (e.g., source has insufficient balance, or destination account does not exist), the entire operation rolls back. Partial transfers cannot occur.

---

## 6. Transaction Immutability Protections

- **Application Layer**:
  - No `PUT`, `PATCH`, or `DELETE` endpoints exist for financial records.
  - Attempting HTTP `PUT`, `PATCH`, or `DELETE` on `/api/v1/accounts/:accountId/transactions` or `/api/v1/transfers` triggers `HTTP 405 Method Not Allowed` with error code `METHOD_NOT_ALLOWED`.
- **Database Trigger Layer**:
  - The PostgreSQL function `prevent_transaction_mutation()` is bound to triggers `trg_prevent_transactions_update_delete` and `trg_prevent_transfers_update_delete` on `BEFORE UPDATE OR DELETE ON transactions` and `transfers`.
  - Any direct SQL `UPDATE` or `DELETE` query executed against transaction or transfer rows is immediately aborted by PostgreSQL with exception `'Transaction records are immutable and cannot be updated or deleted'`.
- **Correction Mechanism**:
  - Erroneous transactions are never erased or modified. They are corrected exclusively through explicit reversing or compensating transactions, preserving an accurate historical audit trail.
- **Administrative Transparency**:
  - The database trigger acknowledges that a PostgreSQL superuser with full physical access could disable database triggers (`ALTER TABLE ... DISABLE TRIGGER ALL`). Hardware-level WORM (Write Once Read Many) or HSM cryptographic signing would be required for absolute administrator immutability. LedgerPro protects against application bugs, rogue developer SQL scripts, and ordinary client tampering.

---

## 7. Concurrency Control and Deadlock Avoidance

- **Pessimistic Row-Level Locking**:
  - When altering account balances, the system acquires an exclusive lock via `SELECT balance FROM accounts WHERE id = $1 FOR UPDATE`.
  - Concurrent requests against the same account are serialized.
- **Overdraft Prevention**:
  - Because `FOR UPDATE` serializes balance checks and updates, simultaneous debit requests competing for the same balance are processed sequentially. If Account A has $100 and two debits of $80 arrive at the exact same millisecond, the first succeeds ($20 remaining) and the second immediately aborts with `HTTP 422 Unprocessable Entity` (`INSUFFICIENT_BALANCE`). The balance never drops negative.
- **Deadlock Elimination for Bidirectional Transfers**:
  - When Account A transfers to Account B while Account B transfers to Account A concurrently, acquiring uncoordinated locks causes cyclic deadlocks (`40P01 deadlocks detected`).
  - LedgerPro implements **deterministic lexicographical UUID lock ordering**:
    ```typescript
    const [firstId, secondId] = sourceAccountId < destinationAccountId 
      ? [sourceAccountId, destinationAccountId] 
      : [destinationAccountId, sourceAccountId];
    ```
    Every transaction acquires row locks in the exact same global order regardless of transfer direction. This mathematically proves deadlock-free concurrency.

---

## 8. Error Status-Code Decisions

LedgerPro implements a predictable, RFC 7807-compliant HTTP error format:

| HTTP Status Code | Error Code | Rationale |
|---|---|---|
| **400 Bad Request** | `VALIDATION_ERROR` | Schema validation failure (Zod): missing fields, negative amounts, invalid UUIDs, malformed JSON, extraneous properties, query syntax errors. |
| **404 Not Found** | `ACCOUNT_NOT_FOUND` | The specified account UUID does not exist in the database. |
| **405 Method Not Allowed** | `METHOD_NOT_ALLOWED` | Mutation HTTP methods (`PUT`, `PATCH`, `DELETE`) targeted at immutable financial ledger or transfer routes. |
| **409 Conflict** | `DUPLICATE_TRANSACTION_REFERENCE` | An idempotent transaction with the specified reference has already been executed. |
| **422 Unprocessable Entity** | `INSUFFICIENT_BALANCE` | Account lacks sufficient funds to complete the requested debit operation. |
| **422 Unprocessable Entity** | `INVALID_TRANSFER_ACCOUNTS` | Attempting a transfer where source and destination account UUIDs are identical. |
| **500 Internal Server Error** | `INTERNAL_SERVER_ERROR` | Unexpected database failure, network disconnect, or unhandled system error. Sanitized so no database connection strings, credentials, or SQL fragments leak to clients. |

---

## 9. Seed Data Behavior

- **Deterministic Entities**:
  - Seeded accounts, transactions, and transfers utilize static hexadecimal UUIDs (`a0000000-...`, `b0000000-...`, `c0000000-...`).
- **Idempotent Execution**:
  - Seeding uses `ON CONFLICT (id) DO UPDATE` for accounts, `ON CONFLICT (account_id, reference_id) DO NOTHING` for transactions, and `ON CONFLICT (reference_id) DO NOTHING` for transfers.
  - The script can be executed repeatedly (`npm run seed`) without duplicating records or corrupting balances.
- **Balance Integrity**:
  - Initial balances in seeded accounts are strictly derived from the sum of their corresponding seeded transaction rows.
  - A reconciliation verification query runs immediately after seeding to prove 100% balance consistency.

---

## 10. Out-of-Scope Features

To maintain a laser-focused, rock-solid core ledger engine, the following capabilities are explicitly treated as out-of-scope for the core MVP:

1. **Authentication & Authorization (AuthN / AuthZ)**: Multi-tenant RBAC, OAuth2, and JWT tokens are handled by external API gateways in production.
2. **Multi-Currency FX**: LedgerPro treats amounts as abstract currency units with two decimal places. Dynamic currency exchange rates are excluded.
3. **Soft-Deletes**: Financial records are never marked "deleted" or hidden.
4. **Asynchronous Message Queues / Webhooks**: Operations execute synchronously via transactional ACID HTTP endpoints. Asynchronous job queues (RabbitMQ, Kafka) can consume ledger events upstream.
