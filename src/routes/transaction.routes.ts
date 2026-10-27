import { Router } from 'express';
import { createTransaction } from '../controllers/transaction.controller';
import { validateBody, validateParams } from '../middleware/validate-request';
import {
  accountParamSchema,
  createTransactionSchema,
} from '../validators/transaction.validator';

const router = Router();

// POST /api/v1/accounts/:accountId/transactions - Create a credit or debit transaction
router.post(
  '/accounts/:accountId/transactions',
  validateParams(accountParamSchema),
  validateBody(createTransactionSchema),
  createTransaction
);

export default router;
