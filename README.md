# LedgerPro — Financial Transaction Ledger API

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-lightgrey.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-blue.svg)](https://www.postgresql.org/)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-yellow.svg)](https://vitest.dev/)

> A production-grade, highly reliable, and fault-tolerant financial ledger backend engine engineered with strict ACID compliance, mathematical balance precision, immutable transaction records, and deadlock-free concurrent execution.

---

## 📑 Table of Contents

- [Overview](#overview)
- [The Three Core Differentiators](#the-three-core-differentiators)
- [Architecture & Design Principles](#architecture--design-principles)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Database Migrations & Seeding](#database-migrations--seeding)
- [Running the Application](#running-the-application)
- [Running Automated Tests](#running-automated-tests)
- [API Overview](#api-overview)
- [API Demo](#api-demo)
- [Postman Collection](#postman-collection)
- [Related Documentation](#related-documentation)

---

## Overview

**LedgerPro** is a robust financial accounting engine built from the ground up to solve the hardest problems in financial systems:
- Accidental double-spending and network replay attacks.
- Non-negative balance enforcement under extreme concurrent load.
- Tamper-resistant historical audit trails.
- Deadlock-free multi-party money transfers.

Unlike naive ledger implementations that rely on in-memory balance updates or unindexed floating-point numbers, LedgerPro enforces **dual-layer guarantees**: strict schema validation and in-memory BigInt precision combined with PostgreSQL database-level row locks, foreign keys, and database mutation triggers.

---

## The Three Core Differentiators

### 1. Idempotent Transaction Processing
*Prevents duplicate financial effects when network retries occur or duplicate requests arrive simultaneously.*

- **Account-Scoped References:** Every credit and debit request requires a client-supplied `reference_id`. The database enforces uniqueness via `UNIQUE (account_id, reference_id)`.
- **Global Transfer Idempotency:** Transfers enforce unique reference IDs system-wide via `transfers.reference_id UNIQUE`.
- **Race Condition Immunity:** Idempotency is NOT verified solely through pre-insert queries. PostgreSQL unique constraints catch concurrent duplicate requests (`Promise.all`), converting error code `23505` into a predictable `409 Conflict` (`DUPLICATE_TRANSACTION_REFERENCE`) with the existing record attached.
- **Result:** Retrying a dropped network request is always 100% safe. Exactly one financial effect is ever executed.

### 2. Immutable Financial Ledger
*Guarantees an unalterable, permanent record of every financial movement.*

- **No Mutative Endpoints:** Ledger routes only expose `POST` and `GET`. HTTP verbs `PUT`, `PATCH`, and `DELETE` on financial routes are rejected with `405 Method Not Allowed`.
- **Database Triggers:** PostgreSQL trigger function `prevent_transaction_mutation()` fires on `BEFORE UPDATE OR DELETE ON transactions` and `transfers`. Any direct SQL attempt to update or delete a transaction fails immediately at the database engine level.
- **Audit Reconciliation:** Account balances (`accounts.balance`) are verified against the ledger sum:
  $$\text{Balance} = \sum(\text{Credits}) - \sum(\text{Debits})$$
  Mistakes are corrected exclusively through explicit reversing entries, preserving full auditability.

### 3. Concurrent Transaction Safety & Deadlock Avoidance
*Guarantees zero overdrafts and eliminates cyclic database deadlocks under simultaneous load.*

- **Pessimistic Row-Level Locking:** All balance mutations execute inside an ACID transaction protected by `SELECT ... FOR UPDATE`. Simultaneous requests competing for the same account balance are serialized.
- **Race-Condition Overdraft Prevention:** If an account has $100 and two competing debits of $80 arrive at the exact same millisecond, the first executes successfully ($20 balance) and the second is safely rejected with `422 Unprocessable Entity` (`INSUFFICIENT_BALANCE`). The balance never drops negative.
- **Deterministic Lock Ordering:** Multi-account money transfers sort account UUIDs lexicographically (`min(src, dst)` then `max(src, dst)`) before acquiring row locks. Even when Account A and Account B simultaneously transfer money to each other, both transactions lock accounts in the identical global sequence, mathematically eliminating circular wait conditions (`40P01 deadlocks detected`).

---

## Architecture & Design Principles

LedgerPro follows a strict **Layered Clean Architecture**:

```text
HTTP Client / Postman
         │
         ▼
 Express Routers
         │
         ▼
 Zod Validation Middleware  ──▶ Rejects invalid payloads (HTTP 400)
         │
         ▼
 Controllers                ──▶ HTTP request/response orchestration
         │
         ▼
 Domain Services            ──▶ Business logic, BigInt cents math, transaction boundaries
         │
         ▼
 Repositories               ──▶ Parameterized SQL queries, row locks (FOR UPDATE)
         │
         ▼
 PostgreSQL 14+            ──▶ ACID guarantees, check constraints, immutability triggers
```

### In-Memory Currency Engine (BigInt Cents)
To prevent IEEE 754 floating-point rounding inaccuracies (e.g., `0.1 + 0.2 = 0.30000000000000004`), LedgerPro parses decimal string amounts directly into signed **BigInt cents**:
- `$150.25` $\rightarrow$ `15025n` cents
- Calculations (add, subtract, compare) execute entirely on BigInt integers.
- Amounts are formatted back into fixed 2-decimal strings only when writing to PostgreSQL or sending HTTP responses.

---

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Runtime** | Node.js (v18+) | Non-blocking asynchronous I/O |
| **Language** | TypeScript (v5.x) | Static type safety and domain models |
| **Framework** | Express.js (v5.x) | Minimalist, high-performance HTTP server |
| **Database** | PostgreSQL (v14+) | ACID compliance, row locks, triggers, constraints |
| **Driver** | `pg` (node-postgres) | Native connection pooling and client transactions |
| **Validation** | Zod (v4.x) | Runtime schema validation with strict object filtering |
| **Testing** | Vitest & Supertest | Sub-second concurrent integration test execution |

---

## Prerequisites

Before running LedgerPro, ensure your environment has:
1. **Node.js**: `v18.0.0` or higher ([Download](https://nodejs.org/))
2. **PostgreSQL**: `v14.0` or higher ([Download](https://www.postgresql.org/))
3. **npm**: `v9.0.0` or higher

---

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/haritech005/LedgerPro.git
   cd LedgerPro
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to configure your PostgreSQL credentials:
   ```env
   PORT=3000
   NODE_ENV=development
   DATABASE_URL=postgresql://postgres:your_password@localhost:5432/ledgerpro
   ```

---

## Database Migrations & Seeding

1. **Run Database Migrations:**
   Creates tables (`accounts`, `transactions`, `transfers`), indexes, and triggers:
   ```bash
   npm run migrate
   ```

2. **Seed Sample Data:**
   Inserts realistic, mathematically reconciled sample accounts and transactions:
   ```bash
   npm run seed
   ```

   **Sample Seeded Accounts:**
   - `a0000000-0000-0000-0000-000000000001`: Alice Smith ($1,350.00)
   - `a0000000-0000-0000-0000-000000000002`: Bob Jones ($2,000.00)
   - `a0000000-0000-0000-0000-000000000003`: Charlie Brown ($1,000.00)
   - `a0000000-0000-0000-0000-000000000004`: Corporate Treasury ($450,000.00)
   - `a0000000-0000-0000-0000-000000000005`: Escrow Reserve ($25,000.00)
   - `a0000000-0000-0000-0000-000000000006`: Dormant Zero Balance Account ($0.00)

---

## Running the Application

- **Development Mode (with hot-reload):**
  ```bash
  npm run dev
  ```

- **Production Build & Start:**
  ```bash
  npm run build
  npm start
  ```
  The server starts at `http://localhost:3000`.

---

## Running Automated Tests

LedgerPro includes a comprehensive automated test suite covering all 11 phases, verifying edge cases, validations, database rollbacks, race conditions, and deadlocks:

```bash
# Run all integration and unit tests once
npm test

# Run tests in watch mode
npm run test:watch
```

**Test Coverage Summary:**
- 11 test suites / 121 automated integration tests
- 100% pass rate under concurrent execution

---

## API Overview

All endpoints are versioned under `/api/v1`. For detailed request/response schemas, validation rules, error catalogs, and curl examples, refer to [API.md](API.md).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Check service health status and PostgreSQL connectivity |
| `POST` | `/api/v1/accounts` | Create a new ledger account (initial zero balance) |
| `POST` | `/api/v1/accounts/:accountId/transactions` | Post an idempotent credit or debit transaction |
| `GET` | `/api/v1/accounts/:accountId/balance` | Retrieve current settled account balance |
| `GET` | `/api/v1/accounts/:accountId/transactions` | Query paginated transaction history with type filters |
| `POST` | `/api/v1/transfers` | Atomic, deadlock-free money transfer between two accounts |

---

## API Demo

Watch the Postman demonstration to see the API workflows, transaction processing, balance updates, validation, and error handling in action.

- **Demo Video:** [https://drive.google.com/file/d/11e7wxnZC8U7JuT7EPR063dUf0JTuGFLH/view?usp=sharing](https://drive.google.com/file/d/11e7wxnZC8U7JuT7EPR063dUf0JTuGFLH/view?usp=sharing)
- **Postman Collection:** [View the Collection](postman/ledgerpro.postman_collection.json)

---

## Postman Collection

A full, ready-to-run Postman collection is maintained at:
[`postman/ledgerpro.postman_collection.json`](postman/ledgerpro.postman_collection.json)

**Included Test Folders:**
1. `Health and Setup`
2. `Accounts`
3. `Credit and Debit`
4. `Duplicate Prevention`
5. `Balance`
6. `Transaction History`
7. `Immutability and Integrity`
8. `Comprehensive Validation`
9. `Centralized Error Handling`
10. `Money Transfer API`
11. `Audit Verification and Reliability`

Simply import the JSON file into Postman, configure the `baseUrl` variable to `http://localhost:3000`, and execute.

---

## Related Documentation

- 📖 [**API Documentation (API.md)**](API.md) — Exhaustive specification of all endpoints, parameters, error contracts, and status codes.
- 📐 [**Engineering Assumptions (ASSUMPTIONS.md)**](ASSUMPTIONS.md) — Deep-dive into design decisions, precision limits, deadlock prevention algorithms, and out-of-scope features.
