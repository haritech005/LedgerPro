import { z } from 'zod';
import { validateAmount } from '../utils/money';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createTransferSchema = z
  .record(z.string(), z.any())
  .superRefine((data, ctx) => {
    // 1. Check for system-controlled fields
    if ('id' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Transfer ID is system-generated and cannot be provided.',
      });
      return;
    }

    if ('created_at' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['created_at'],
        message: 'Transfer creation timestamp is system-generated and cannot be provided.',
      });
      return;
    }

    if ('debit_transaction_id' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['debit_transaction_id'],
        message: 'Debit transaction ID is system-generated and cannot be provided.',
      });
      return;
    }

    if ('credit_transaction_id' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credit_transaction_id'],
        message: 'Credit transaction ID is system-generated and cannot be provided.',
      });
      return;
    }

    // 2. Reject unrecognized fields
    const allowedKeys = new Set([
      'source_account_id',
      'destination_account_id',
      'amount',
      'reference_id',
      'description',
    ]);
    const extraKeys = Object.keys(data).filter((k) => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unrecognized field(s): ${extraKeys.join(', ')}`,
      });
      return;
    }

    // 3. Validate source_account_id
    if (!data.source_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_account_id'],
        message: 'Source account ID is required',
      });
      return;
    }

    if (
      typeof data.source_account_id !== 'string' ||
      !UUID_REGEX.test(data.source_account_id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_account_id'],
        message: 'Source account ID must be a valid UUID',
      });
      return;
    }

    // 4. Validate destination_account_id
    if (!data.destination_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination_account_id'],
        message: 'Destination account ID is required',
      });
      return;
    }

    if (
      typeof data.destination_account_id !== 'string' ||
      !UUID_REGEX.test(data.destination_account_id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination_account_id'],
        message: 'Destination account ID must be a valid UUID',
      });
      return;
    }

    // 5. Ensure source and destination are different
    if (data.source_account_id === data.destination_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination_account_id'],
        message: 'Source and destination accounts must be different.',
      });
      return;
    }

    // 6. Validate amount
    const amountValidation = validateAmount(data.amount);
    if (!amountValidation.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: amountValidation.error || 'Invalid amount.',
      });
      return;
    }

    // 7. Validate reference_id
    if (data.reference_id === undefined || data.reference_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference_id'],
        message: 'Transfer reference ID is required',
      });
      return;
    }

    if (typeof data.reference_id !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference_id'],
        message: 'Transfer reference ID must be a string',
      });
      return;
    }

    const trimmedRef = data.reference_id.trim();
    if (trimmedRef.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference_id'],
        message: 'Transfer reference ID cannot be empty or whitespace only',
      });
      return;
    }

    if (trimmedRef.length > 255) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference_id'],
        message: 'Transfer reference ID cannot exceed 255 characters',
      });
      return;
    }

    // 8. Validate description
    if (data.description === undefined || data.description === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Transfer description is required',
      });
      return;
    }

    if (typeof data.description !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Transfer description must be a string',
      });
      return;
    }

    const trimmedDesc = data.description.trim();
    if (trimmedDesc.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Transfer description cannot be empty or whitespace only',
      });
      return;
    }

    if (trimmedDesc.length > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Transfer description cannot exceed 500 characters',
      });
      return;
    }
  })
  .transform((data) => {
    const { formatted } = validateAmount(data.amount);
    return {
      source_account_id: data.source_account_id as string,
      destination_account_id: data.destination_account_id as string,
      amount: formatted as string,
      reference_id: (data.reference_id as string).trim(),
      description: (data.description as string).trim(),
    };
  });

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
