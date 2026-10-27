import { accountRepository, AccountRepository } from '../repositories/account.repository';
import { Account, CreateAccountDTO } from '../types/account.types';
import { AppError } from '../errors/app-error';

export class AccountService {
  constructor(private readonly accountRepo: AccountRepository = accountRepository) {}

  /**
   * Creates a new account with a guaranteed zero initial balance.
   */
  async createAccount(dto: CreateAccountDTO): Promise<Account> {
    const trimmedName = dto.name?.trim();

    if (!trimmedName) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Account holder name is required and cannot be empty.');
    }

    return this.accountRepo.create(trimmedName);
  }

  /**
   * Retrieves an account by its ID.
   */
  async getAccountById(id: string): Promise<Account> {
    const account = await this.accountRepo.findById(id);
    if (!account) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Account with ID '${id}' was not found.`);
    }
    return account;
  }

  /**
   * Retrieves the current balance for an existing account.
   */
  async getAccountBalance(id: string): Promise<{ account_id: string; balance: string }> {
    const account = await this.getAccountById(id);
    return {
      account_id: account.id,
      balance: account.balance,
    };
  }
}

export const accountService = new AccountService();
