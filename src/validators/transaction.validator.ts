import { z } from 'zod';
import { validateAmount } from '../utils/money';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const accountParamSchema = z.object({
  accountId: z
    .string({
      message: 'Account ID is required',
    })
    .regex(UUID_REGEX, 'Invalid account ID format. Must be a valid UUID.'),
});

export const createTransactionSchema = z
  .record(z.string(), z.any())
  .superRefine((data, ctx) => {
    // 1. Check for system-controlled fields first
    if ('id' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Transaction ID is system-generated and cannot be provided.',
      });
      return;
    }

    if ('created_at' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['created_at'],
        message: 'Transaction creation timestamp is system-generated and cannot be provided.',
      });
      return;
    }

    if ('account_id' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['account_id'],
        message: 'Account ID is derived from the URL path and cannot be specified in the request body.',
      });
      return;
    }

    // 2. Reject unrecognized fields
    const allowedKeys = new Set(['type', 'amount', 'description', 'reference_id']);
    const extraKeys = Object.keys(data).filter((k) => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unrecognized field(s): ${extraKeys.join(', ')}`,
      });
      return;
    }

    // 3. Validate transaction type
    if (data.type === undefined || data.type === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'Transaction type is required',
      });
      return;
    }

    if (data.type !== 'credit' && data.type !== 'debit') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: "Invalid transaction type. Must be either 'credit' or 'debit'.",
      });
      return;
    }

    // 4. Validate amount
    const amountValidation = validateAmount(data.amount);
    if (!amountValidation.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: amountValidation.error || 'Invalid amount.',
      });
      return;
    }

    // 5. Validate description
    if (data.description === undefined || data.description === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Transaction description is required',
      });
      return;
    }

    if (typeof data.description !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Transaction description must be a string',
      });
      return;
    }

    const trimmedDesc = data.description.trim();
    if (trimmedDesc.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Transaction description cannot be empty or whitespace only',
      });
      return;
    }

    if (trimmedDesc.length > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Transaction description cannot exceed 500 characters',
      });
      return;
    }

    // 6. Validate reference_id
    if (data.reference_id === undefined || data.reference_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference_id'],
        message: 'Transaction reference ID is required',
      });
      return;
    }

    if (typeof data.reference_id !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference_id'],
        message: 'Transaction reference ID must be a string',
      });
      return;
    }

    const trimmedRef = data.reference_id.trim();
    if (trimmedRef.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference_id'],
        message: 'Transaction reference ID cannot be empty or whitespace only',
      });
      return;
    }

    if (trimmedRef.length > 255) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference_id'],
        message: 'Transaction reference ID cannot exceed 255 characters',
      });
      return;
    }
  })
  .transform((data) => {
    const { formatted } = validateAmount(data.amount);
    return {
      type: data.type as 'credit' | 'debit',
      amount: formatted as string,
      description: (data.description as string).trim(),
      reference_id: (data.reference_id as string).trim(),
    };
  });

export const transactionHistoryQuerySchema = z
  .object({
    type: z.enum(['credit', 'debit'] as const).optional(),
    page: z.coerce
      .number({
        message: 'Page must be a valid positive integer',
      })
      .int('Page must be an integer')
      .positive('Page must be greater than zero')
      .default(1),
    limit: z.coerce
      .number({
        message: 'Limit must be a valid positive integer',
      })
      .int('Limit must be an integer')
      .positive('Limit must be greater than zero')
      .max(100, 'Limit cannot exceed maximum of 100 records per page')
      .default(10),
  })
  .strict();

export type TransactionHistoryQueryInput = z.infer<typeof transactionHistoryQuerySchema>;

