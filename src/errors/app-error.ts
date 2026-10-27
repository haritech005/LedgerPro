/**
 * Base Application Error class representing an operational, known error in LedgerPro.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(statusCode: number, code: string, message: string, details?: any) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 400 Bad Request — Input validation failure.
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

/**
 * 404 Not Found — Requested resource was not found.
 */
export class NotFoundError extends AppError {
  constructor(message: string, code: string = 'NOT_FOUND', details?: any) {
    super(404, code, message, details);
    this.name = 'NotFoundError';
  }
}

/**
 * 404 Not Found — Specifically for missing accounts.
 */
export class AccountNotFoundError extends NotFoundError {
  constructor(accountId: string) {
    super(
      `Account with ID '${accountId}' was not found.`,
      'ACCOUNT_NOT_FOUND',
      { account_id: accountId }
    );
    this.name = 'AccountNotFoundError';
  }
}

/**
 * 409 Conflict — Duplicate transaction reference submission for an account.
 */
export class DuplicateTransactionError extends AppError {
  constructor(referenceId: string, existingTx?: any) {
    super(
      409,
      'DUPLICATE_TRANSACTION_REFERENCE',
      `A transaction with reference ID '${referenceId}' has already been processed for this account.`,
      existingTx
    );
    this.name = 'DuplicateTransactionError';
  }
}

/**
 * 422 Unprocessable Content — Business logic failure such as insufficient funds.
 */
export class InsufficientBalanceError extends AppError {
  constructor(message: string = 'The account does not have sufficient funds.') {
    super(422, 'INSUFFICIENT_BALANCE', message);
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * 405 Method Not Allowed — Attempt to mutate or delete immutable ledger records.
 */
export class MethodNotAllowedError extends AppError {
  constructor(
    message: string = 'Transaction records are immutable. Modifying or deleting transactions is strictly prohibited.'
  ) {
    super(405, 'METHOD_NOT_ALLOWED', message);
    this.name = 'MethodNotAllowedError';
  }
}

/**
 * 500 Internal Server Error — Unexpected failure.
 */
export class InternalServerError extends AppError {
  constructor(
    message: string = 'An unexpected internal server error occurred.'
  ) {
    super(500, 'INTERNAL_SERVER_ERROR', message);
    this.name = 'InternalServerError';
  }
}
