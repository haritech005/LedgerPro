import { z } from 'zod';

export const createAccountSchema = z
  .record(z.string(), z.any())
  .superRefine((data, ctx) => {
    // 1. Check for system-controlled fields first to return specific error messages
    if ('balance' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['balance'],
        message: 'Initial balance cannot be provided. Accounts always start with a zero balance.',
      });
      return;
    }

    if ('id' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Account ID is system-generated and cannot be provided.',
      });
      return;
    }

    if ('created_at' in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['created_at'],
        message: 'Account creation timestamp is system-generated and cannot be provided.',
      });
      return;
    }

    // 2. Reject any unrecognized fields
    const allowedKeys = new Set(['name']);
    const extraKeys = Object.keys(data).filter((k) => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unrecognized field(s): ${extraKeys.join(', ')}`,
      });
      return;
    }

    // 3. Validate name field
    if (data.name === undefined || data.name === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Account holder name is required',
      });
      return;
    }

    if (typeof data.name !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Account holder name must be a string',
      });
      return;
    }

    const trimmed = data.name.trim();
    if (trimmed.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Account holder name cannot be empty or whitespace only',
      });
      return;
    }

    if (trimmed.length > 255) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Account holder name cannot exceed 255 characters',
      });
      return;
    }
  })
  .transform((data) => ({
    name: (data.name as string).trim(),
  }));

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
