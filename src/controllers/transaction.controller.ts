import { Request, Response, NextFunction } from 'express';
import { transactionService } from '../services/transaction.service';

export async function createTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const accountId = req.params.accountId as string;
    const transaction = await transactionService.createTransaction(
      accountId,
      req.body
    );
    res.status(201).json(transaction);
  } catch (error) {
    next(error);
  }
}

export async function getTransactionHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const accountId = req.params.accountId as string;
    const query = ((req as any).validatedQuery || req.query) as any;
    const history = await transactionService.getTransactionHistory(
      accountId,
      query
    );
    res.status(200).json(history);
  } catch (error) {
    next(error);
  }
}
