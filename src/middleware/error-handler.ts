import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error';

/**
 * Centralized application error handling middleware.
 * Ensures consistent response shape, protects internal details from leaking,
 * and maps all known and unexpected errors to documented HTTP status codes.
 */
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // If headers already sent, delegate to default Express handler
  if (res.headersSent) {
    return _next(err);
  }

  // 1. Handle malformed JSON body errors from express.json()
  if (err instanceof SyntaxError && ('body' in err || (err as any).status === 400)) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body.',
      },
    });
    return;
  }

  // 2. Handle structured application domain errors
  if (err instanceof AppError) {
    const responseBody: any = {
      error: {
        code: err.code,
        message: err.message,
      },
    };

    if (err.details !== undefined) {
      responseBody.error.details = err.details;
    }

    res.status(err.statusCode).json(responseBody);
    return;
  }

  // 3. Handle unexpected internal / database / runtime errors
  // Log unexpected errors safely on server without leaking details to client
  if (process.env.NODE_ENV !== 'test') {
    console.error('Unhandled Internal Server Error:', err);
  }

  // Return sanitized 500 error response without raw SQL, stack traces, or credentials
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred.',
    },
  });
}
