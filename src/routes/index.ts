import { Router } from 'express';
import healthRoutes from './health.routes';

const router = Router();

// Phase 1: Mount health endpoint at /api/v1/health
router.use('/', healthRoutes);

export default router;
