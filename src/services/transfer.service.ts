import { pool } from '../config/database';
import { accountRepository, AccountRepository } from '../repositories/account.repository';
import { transactionRepository, TransactionRepository } from '../repositories/transaction.repository';
import { transferRepository, TransferRepository } from '../repositories/transfer.repository';
import { Transfer, CreateTransferDTO } from '../types/transfer.types';
import {
  NotFoundError,
  DuplicateTransactionError,
  InsufficientBalanceError,
  ValidationError,
} from '../errors/app-error';
import { toCents, fromCents } from '../utils/money';

export class TransferService {
  constructor(
    private readonly accountRepo: AccountRepository = accountRepository,
    private readonly transactionRepo: TransactionRepository = transactionRepository,
    private readonly transferRepo: TransferRepository = transferRepository
  ) {}

  /**
   * Executes an atomic money transfer between two accounts within a single database transaction.
   * Locks accounts in consistent order to prevent deadlocks under high concurrency.
   * Creates source debit, destination credit, updates balances, and creates transfer record atomically.
   */
  async createTransfer(dto: CreateTransferDTO): Promise<Transfer> {
    if (dto.source_account_id === dto.destination_account_id) {
      throw new ValidationError('Source and destination accounts must be different.');
    }

    // 1. Fast pre-check: verify if transfer reference already exists
    const existing = await this.transferRepo.findByReference(dto.reference_id);
    if (existing) {
      throw new DuplicateTransactionError(dto.reference_id, {
        reference_id: dto.reference_id,
        existing_transfer_id: existing.id,
        source_account_id: existing.source_account_id,
        destination_account_id: existing.destination_account_id,
        amount: existing.amount,
        created_at: existing.created_at,
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 2. Lock both accounts in consistent alphabetical order to prevent deadlocks
      const [firstId, secondId] =
        dto.source_account_id < dto.destination_account_id
          ? [dto.source_account_id, dto.destination_account_id]
          : [dto.destination_account_id, dto.source_account_id];

      const firstAccount = await this.accountRepo.findByIdForUpdate(firstId, client);
      const secondAccount = await this.accountRepo.findByIdForUpdate(secondId, client);

      // Verify both accounts exist and identify which was missing
      const isSourceFirst = firstId === dto.source_account_id;
      const sourceAccount = isSourceFirst ? firstAccount : secondAccount;
      const destAccount = isSourceFirst ? secondAccount : firstAccount;

      if (!sourceAccount) {
        throw new NotFoundError(
          `Source account with ID '${dto.source_account_id}' was not found.`,
          'ACCOUNT_NOT_FOUND',
          { account_id: dto.source_account_id }
        );
      }

      if (!destAccount) {
        throw new NotFoundError(
          `Destination account with ID '${dto.destination_account_id}' was not found.`,
          'ACCOUNT_NOT_FOUND',
          { account_id: dto.destination_account_id }
        );
      }

      // 3. Perform exact monetary calculations using BigInt cents
      const sourceBalanceCents = toCents(sourceAccount.balance);
      const destBalanceCents = toCents(destAccount.balance);
      const transferAmountCents = toCents(dto.amount);

      // 4. Verify source account has sufficient funds
      if (sourceBalanceCents < transferAmountCents) {
        throw new InsufficientBalanceError(
          'The source account does not have sufficient funds for this transfer.'
        );
      }

      const newSourceBalanceCents = sourceBalanceCents - transferAmountCents;
      const newDestBalanceCents = destBalanceCents + transferAmountCents;

      // 5. Record immutable debit transaction for source account
      const debitTx = await this.transactionRepo.create(
        {
          account_id: dto.source_account_id,
          type: 'debit',
          amount: fromCents(transferAmountCents),
          description: dto.description || `Transfer to ${dto.destination_account_id}`,
          reference_id: `transfer:${dto.reference_id}:debit`,
        },
        client
      );

      // 6. Record immutable credit transaction for destination account
      const creditTx = await this.transactionRepo.create(
        {
          account_id: dto.destination_account_id,
          type: 'credit',
          amount: fromCents(transferAmountCents),
          description: dto.description || `Transfer from ${dto.source_account_id}`,
          reference_id: `transfer:${dto.reference_id}:credit`,
        },
        client
      );

      // 7. Update both accounts' balances atomically
      await this.accountRepo.updateBalance(
        dto.source_account_id,
        fromCents(newSourceBalanceCents),
        client
      );
      await this.accountRepo.updateBalance(
        dto.destination_account_id,
        fromCents(newDestBalanceCents),
        client
      );

      // 8. Record transfer linking both transactions
      const transfer = await this.transferRepo.create(
        {
          source_account_id: dto.source_account_id,
          destination_account_id: dto.destination_account_id,
          amount: fromCents(transferAmountCents),
          reference_id: dto.reference_id,
          description: dto.description,
          debit_transaction_id: debitTx.id,
          credit_transaction_id: creditTx.id,
        },
        client
      );

      // 9. Commit atomic database transaction
      await client.query('COMMIT');

      return transfer;
    } catch (error: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Suppress rollback errors to preserve original exception
      }

      // Check for duplicate constraint violation on transfers.reference_id
      if (
        error.code === '23505' &&
        (error.constraint?.includes('transfers') ||
          error.detail?.includes('reference_id'))
      ) {
        const existingTransfer = await this.transferRepo.findByReference(
          dto.reference_id
        );

        throw new DuplicateTransactionError(
          dto.reference_id,
          existingTransfer
            ? {
                reference_id: dto.reference_id,
                existing_transfer_id: existingTransfer.id,
                source_account_id: existingTransfer.source_account_id,
                destination_account_id: existingTransfer.destination_account_id,
                amount: existingTransfer.amount,
                created_at: existingTransfer.created_at,
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

export const transferService = new TransferService();
