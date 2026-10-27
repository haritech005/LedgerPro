import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';
import { AppError } from '../errors/app-error';

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const error: ZodError = result.error;
      const firstIssue = error.issues[0];
      const message = firstIssue?.message || 'Invalid request payload';
      const details = error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return next(new AppError(400, 'VALIDATION_ERROR', message, details));
    }

    req.body = result.data;
    next();
  };
}

export function validateParams(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const error: ZodError = result.error;
      const firstIssue = error.issues[0];
      const message = firstIssue?.message || 'Invalid URL parameters';
      const details = error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return next(new AppError(400, 'VALIDATION_ERROR', message, details));
    }

    req.params = result.data as any;
    next();
  };
}
