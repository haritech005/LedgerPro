import { Router } from 'express';
import healthRoutes from './health.routes';
import accountRoutes from './account.routes';
import transactionRoutes from './transaction.routes';
import transferRoutes from './transfer.routes';

const router = Router();

// Phase 1: Health endpoint
router.use('/', healthRoutes);

// Phase 2: Account management endpoints
router.use('/', accountRoutes);

// Phase 3 & 6: Transaction management endpoints
router.use('/', transactionRoutes);

// Phase 10: Money transfer endpoints
router.use('/', transferRoutes);

export default router;
