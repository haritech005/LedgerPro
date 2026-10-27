import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // If headers already sent, delegate to Express default handler
  if (res.headersSent) {
    return _next(err);
  }

  // Handle malformed JSON body errors from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body.',
      },
    });
    return;
  }

  // Known application errors or status codes
  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
  const errorCode = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR');
  const message =
    statusCode === 500
      ? 'An unexpected internal server error occurred.'
      : err.message || 'An error occurred processing the request.';

  // Log unexpected internal errors (500) without exposing credentials to client
  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    console.error('Unhandled Server Error:', err);
  }

  const responseBody: any = {
    error: {
      code: errorCode,
      message,
    },
  };

  if (err.details !== undefined) {
    responseBody.error.details = err.details;
  }

  res.status(statusCode).json(responseBody);
}
