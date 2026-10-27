import { Router, Request, Response } from 'express';
import {
  createTransaction,
  getTransactionHistory,
} from '../controllers/transaction.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate-request';
import {
  accountParamSchema,
  createTransactionSchema,
  emptyQuerySchema,
  transactionHistoryQuerySchema,
} from '../validators/transaction.validator';

const router = Router();

/**
 * Rejection handler for prohibited transaction modification or deletion attempts.
 * Enforces API-level immutability guarantee.
 */
const rejectImmutableMutation = (_req: Request, res: Response): void => {
  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message:
        'Transaction records are immutable. Modifying or deleting transactions is strictly prohibited.',
    },
  });
};

// POST /api/v1/accounts/:accountId/transactions - Create a credit or debit transaction
router.post(
  '/accounts/:accountId/transactions',
  validateParams(accountParamSchema),
  validateQuery(emptyQuerySchema),
  validateBody(createTransactionSchema),
  createTransaction
);

// GET /api/v1/accounts/:accountId/transactions - Retrieve paginated transaction history
router.get(
  '/accounts/:accountId/transactions',
  validateParams(accountParamSchema),
  validateQuery(transactionHistoryQuerySchema),
  getTransactionHistory
);

// Explicitly reject any HTTP attempts to modify or delete transactions collection
router
  .route('/accounts/:accountId/transactions')
  .put(rejectImmutableMutation)
  .delete(rejectImmutableMutation)
  .patch(rejectImmutableMutation);

// Explicitly reject any HTTP attempts to modify or delete an individual transaction record
router
  .route('/accounts/:accountId/transactions/:transactionId')
  .put(rejectImmutableMutation)
  .delete(rejectImmutableMutation)
  .patch(rejectImmutableMutation);

export default router;
