import { pool } from '../config/database';
import { accountRepository, AccountRepository } from '../repositories/account.repository';
import { transactionRepository, TransactionRepository } from '../repositories/transaction.repository';
import {
  Transaction,
  CreateTransactionDTO,
  PaginatedTransactions,
  TransactionHistoryQuery,
} from '../types/transaction.types';
import {
  AccountNotFoundError,
  DuplicateTransactionError,
  InsufficientBalanceError,
  ValidationError,
} from '../errors/app-error';
import { toCents, fromCents } from '../utils/money';

export class TransactionService {
  constructor(
    private readonly accountRepo: AccountRepository = accountRepository,
    private readonly transactionRepo: TransactionRepository = transactionRepository
  ) {}

  /**
   * Executes a credit or debit transaction atomically within a database transaction.
   * Guarantees idempotency and duplicate prevention sequentially and under high concurrency.
   */
  async createTransaction(
    accountId: string,
    dto: CreateTransactionDTO
  ): Promise<Transaction> {
    // 1. Fast pre-check: verify if reference already exists for this account
    const existing = await this.transactionRepo.findByAccountAndReference(
      accountId,
      dto.reference_id
    );

    if (existing) {
      throw new DuplicateTransactionError(dto.reference_id, {
        reference_id: dto.reference_id,
        existing_transaction_id: existing.id,
        type: existing.type,
        amount: existing.amount,
        created_at: existing.created_at,
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 2. Safely lock and fetch account state using SELECT ... FOR UPDATE
      const account = await this.accountRepo.findByIdForUpdate(accountId, client);
      if (!account) {
        throw new AccountNotFoundError(accountId);
      }

      // 3. Perform exact currency arithmetic using BigInt cents
      const currentBalanceCents = toCents(account.balance);
      const amountCents = toCents(dto.amount);

      let newBalanceCents: bigint;

      if (dto.type === 'credit') {
        newBalanceCents = currentBalanceCents + amountCents;
      } else if (dto.type === 'debit') {
        if (currentBalanceCents < amountCents) {
          throw new InsufficientBalanceError();
        }
        newBalanceCents = currentBalanceCents - amountCents;
      } else {
        throw new ValidationError(
          "Invalid transaction type. Must be either 'credit' or 'debit'."
        );
      }

      // 4. Create immutable transaction record
      const transaction = await this.transactionRepo.create(
        {
          account_id: accountId,
          type: dto.type,
          amount: fromCents(amountCents),
          description: dto.description,
          reference_id: dto.reference_id,
        },
        client
      );

      // 5. Atomically update the account balance
      await this.accountRepo.updateBalance(
        accountId,
        fromCents(newBalanceCents),
        client
      );

      // 6. Commit database transaction
      await client.query('COMMIT');

      return transaction;
    } catch (error: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Suppress rollback errors to preserve original exception
      }

      // Check for PostgreSQL unique constraint violation on (account_id, reference_id)
      // This protects against concurrent race conditions where two requests arrive simultaneously
      if (
        error.code === '23505' &&
        (error.constraint === 'uq_transactions_account_reference' ||
          error.detail?.includes('reference_id'))
      ) {
        const existingTx = await this.transactionRepo.findByAccountAndReference(
          accountId,
          dto.reference_id
        );

        throw new DuplicateTransactionError(
          dto.reference_id,
          existingTx
            ? {
                reference_id: dto.reference_id,
                existing_transaction_id: existingTx.id,
                type: existingTx.type,
                amount: existingTx.amount,
                created_at: existingTx.created_at,
              }
            : undefined
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves paginated, sorted, and filtered transaction history for an account.
   */
  async getTransactionHistory(
    accountId: string,
    query: TransactionHistoryQuery
  ): Promise<PaginatedTransactions> {
    // 1. Verify account exists
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    // 2. Fetch history and count
    const { transactions, total } = await this.transactionRepo.findHistory(
      accountId,
      query
    );

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

    return {
      account_id: accountId,
      page: query.page,
      limit: query.limit,
      total_records: total,
      total_pages: totalPages,
      data: transactions,
    };
  }
}

export const transactionService = new TransactionService();
