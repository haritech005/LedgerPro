import { pool } from '../config/database';
import { accountRepository, AccountRepository } from '../repositories/account.repository';
import { transactionRepository, TransactionRepository } from '../repositories/transaction.repository';
import { Transaction, CreateTransactionDTO } from '../types/transaction.types';
import { AppError } from '../errors/app-error';
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
      throw new AppError(
        409,
        'DUPLICATE_TRANSACTION_REFERENCE',
        `A transaction with reference ID '${dto.reference_id}' has already been processed for this account.`,
        {
          reference_id: dto.reference_id,
          existing_transaction_id: existing.id,
          type: existing.type,
          amount: existing.amount,
          created_at: existing.created_at,
        }
      );
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 2. Safely lock and fetch account state using SELECT ... FOR UPDATE
      const account = await this.accountRepo.findByIdForUpdate(accountId, client);
      if (!account) {
        throw new AppError(
          404,
          'ACCOUNT_NOT_FOUND',
          `Account with ID '${accountId}' was not found.`
        );
      }

      // 3. Perform exact currency arithmetic using BigInt cents
      const currentBalanceCents = toCents(account.balance);
      const amountCents = toCents(dto.amount);

      let newBalanceCents: bigint;

      if (dto.type === 'credit') {
        newBalanceCents = currentBalanceCents + amountCents;
      } else if (dto.type === 'debit') {
        if (currentBalanceCents < amountCents) {
          throw new AppError(
            422,
            'INSUFFICIENT_BALANCE',
            'The account does not have sufficient funds.'
          );
        }
        newBalanceCents = currentBalanceCents - amountCents;
      } else {
        throw new AppError(
          400,
          'INVALID_TRANSACTION_TYPE',
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
      await client.query('ROLLBACK');

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

        throw new AppError(
          409,
          'DUPLICATE_TRANSACTION_REFERENCE',
          `A transaction with reference ID '${dto.reference_id}' has already been processed for this account.`,
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
}

export const transactionService = new TransactionService();
