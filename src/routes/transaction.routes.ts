import { Router } from 'express';
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
  transactionHistoryQuerySchema,
} from '../validators/transaction.validator';

const router = Router();

// POST /api/v1/accounts/:accountId/transactions - Create a credit or debit transaction
router.post(
  '/accounts/:accountId/transactions',
  validateParams(accountParamSchema),
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

export default router;
