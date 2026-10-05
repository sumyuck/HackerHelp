import { Router } from 'express';
import multer from 'multer';
import { getAnalyticsMetrics, getSupportAnalytics } from '../controllers/analytics.controller';
import { uploadDocument } from '../controllers/document.controller';
import { requireAdminToken } from '../middleware/admin-auth';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // Limit file uploads to 10MB
  }
});

// Every API route is operator-only.
router.use(requireAdminToken);

// Analytics Dashboard Endpoint
router.get('/analytics', getAnalyticsMetrics);
router.get('/analytics/support', getSupportAnalytics);

// RAG Document Indexing Upload Endpoint
router.post('/documents/upload', upload.single('file'), uploadDocument);

export default router;
