const express = require('express');
const multer = require('multer');
const { compressImage, compressPdf } = require('../controllers/scanController');
const router = express.Router();

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
const upload = multer({ storage });

const uploadFlexible = (req, res, next) => {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) return next(err);
    if (req.files) {
      req.file = req.files['file']?.[0] || req.files['image']?.[0] || null;
    }
    next();
  });
};

const handleUniversalCompress = async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Please upload a PDF or an image.' });
  }

  const mime = (req.file.mimetype || '').toLowerCase();
  const originalName = (req.file.originalname || '').toLowerCase();

  if (mime === 'application/pdf' || originalName.endsWith('.pdf')) {
    return compressPdf(req, res);
  }

  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|tiff)$/i.test(originalName)) {
    return compressImage(req, res);
  }

  return res.status(400).json({
    error: 'Unsupported file format. Please upload a PDF or image file (JPG, PNG, WebP).',
  });
};

// Unified endpoint (auto-detects PDF vs image)
router.post('/', uploadFlexible, handleUniversalCompress);

// Dedicated sub-routes for explicit target types
router.post('/image', uploadFlexible, compressImage);
router.post('/pdf', uploadFlexible, compressPdf);

module.exports = router;