import { Router } from 'express';
import multer from 'multer';
import { getAnalyticsMetrics } from '../controllers/analytics.controller';
import { uploadDocument } from '../controllers/document.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // Limit file uploads to 10MB
  }
});

// Analytics Dashboard Endpoint
router.get('/analytics', getAnalyticsMetrics);

// RAG Document Indexing Upload Endpoint
router.post('/documents/upload', upload.single('file'), uploadDocument);

export default router;
