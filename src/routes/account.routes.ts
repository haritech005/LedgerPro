import { Router } from 'express';
import {
  createAccount,
  getAccountBalance,
} from '../controllers/account.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate-request';
import { createAccountSchema } from '../validators/account.validator';
import {
  accountParamSchema,
  emptyQuerySchema,
} from '../validators/transaction.validator';

const router = Router();

// POST /api/v1/accounts - Create a new account with zero initial balance
router.post(
  '/accounts',
  validateQuery(emptyQuerySchema),
  validateBody(createAccountSchema),
  createAccount
);

// GET /api/v1/accounts/:accountId/balance - Retrieve current account balance
router.get(
  '/accounts/:accountId/balance',
  validateParams(accountParamSchema),
  validateQuery(emptyQuerySchema),
  getAccountBalance
);

export default router;
