import { Router } from 'express';
import healthRoutes from './health.routes';
import accountRoutes from './account.routes';

const router = Router();

// Phase 1: Health endpoint
router.use('/', healthRoutes);

// Phase 2: Account management endpoints
router.use('/', accountRoutes);

export default router;
