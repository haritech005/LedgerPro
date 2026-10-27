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

export async function getAccountBalance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const accountId = req.params.accountId as string;
    const balanceData = await accountService.getAccountBalance(accountId);
    res.status(200).json(balanceData);
  } catch (error) {
    next(error);
  }
}
