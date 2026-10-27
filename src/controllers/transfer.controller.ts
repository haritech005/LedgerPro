import { Request, Response, NextFunction } from 'express';
import { transferService } from '../services/transfer.service';

export async function createTransfer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const transfer = await transferService.createTransfer(req.body);
    res.status(201).json(transfer);
  } catch (error) {
    next(error);
  }
}
