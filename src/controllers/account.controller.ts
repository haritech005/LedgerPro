import { Request, Response, NextFunction } from 'express';
import { accountService } from '../services/account.service';

export async function createAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const account = await accountService.createAccount(req.body);
    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
}
