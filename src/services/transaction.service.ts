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
   * Uses row-level locking on the account to prevent concurrent balance anomalies.
   */
  async createTransaction(
    accountId: string,
    dto: CreateTransactionDTO
  ): Promise<Transaction> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Safely lock and fetch account state using SELECT ... FOR UPDATE
      const account = await this.accountRepo.findByIdForUpdate(accountId, client);
      if (!account) {
        throw new AppError(
          404,
          'ACCOUNT_NOT_FOUND',
          `Account with ID '${accountId}' was not found.`
        );
      }

      // 2. Perform exact currency arithmetic using BigInt cents
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

      // 3. Create immutable transaction record
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

      // 4. Atomically update the account balance
      await this.accountRepo.updateBalance(
        accountId,
        fromCents(newBalanceCents),
        client
      );

      // 5. Commit database transaction
      await client.query('COMMIT');

      return transaction;
    } catch (error: any) {
      await client.query('ROLLBACK');

      // Check for PostgreSQL unique constraint violation on (account_id, reference_id)
      if (
        error.code === '23505' &&
        (error.constraint === 'uq_transactions_account_reference' ||
          error.detail?.includes('reference_id'))
      ) {
        throw new AppError(
          409,
          'DUPLICATE_TRANSACTION_REFERENCE',
          `A transaction with reference ID '${dto.reference_id}' already exists for this account.`
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }
}

export const transactionService = new TransactionService();
