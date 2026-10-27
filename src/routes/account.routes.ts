import { Router } from 'express';
import { createAccount } from '../controllers/account.controller';
import { validateBody } from '../middleware/validate-request';
import { createAccountSchema } from '../validators/account.validator';

const router = Router();

// POST /api/v1/accounts - Create a new account with zero initial balance
router.post('/accounts', validateBody(createAccountSchema), createAccount);

export default router;
