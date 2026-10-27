import { Router } from 'express';
import {
  createAccount,
  getAccountBalance,
} from '../controllers/account.controller';
import { validateBody, validateParams } from '../middleware/validate-request';
import { createAccountSchema } from '../validators/account.validator';
import { accountParamSchema } from '../validators/transaction.validator';

const router = Router();

// POST /api/v1/accounts - Create a new account with zero initial balance
router.post('/accounts', validateBody(createAccountSchema), createAccount);

// GET /api/v1/accounts/:accountId/balance - Retrieve current account balance
router.get(
  '/accounts/:accountId/balance',
  validateParams(accountParamSchema),
  getAccountBalance
);

export default router;
