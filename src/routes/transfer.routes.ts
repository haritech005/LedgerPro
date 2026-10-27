import { Router, Request, Response } from 'express';
import { createTransfer } from '../controllers/transfer.controller';
import { validateBody, validateQuery } from '../middleware/validate-request';
import { createTransferSchema } from '../validators/transfer.validator';
import { emptyQuerySchema } from '../validators/transaction.validator';

const router = Router();

/**
 * Rejection handler for prohibited transfer modification or deletion attempts.
 * Enforces API-level transfer immutability.
 */
const rejectImmutableMutation = (_req: Request, res: Response): void => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message:
        'Transfer records are immutable. Modifying or deleting transfers is strictly prohibited.',
    },
  });
};

// POST /api/v1/transfers - Atomic money transfer between two accounts
router.post(
  '/transfers',
  validateQuery(emptyQuerySchema),
  validateBody(createTransferSchema),
  createTransfer
);

// Explicitly reject any HTTP attempts to modify or delete transfers
router
  .route('/transfers')
  .put(rejectImmutableMutation)
  .delete(rejectImmutableMutation)
  .patch(rejectImmutableMutation);

router
  .route('/transfers/:transferId')
  .put(rejectImmutableMutation)
  .delete(rejectImmutableMutation)
  .patch(rejectImmutableMutation);

export default router;
