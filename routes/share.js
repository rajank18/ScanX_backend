const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadFile, getFileInfo, downloadFile } = require('../controllers/shareController');

const router = express.Router();

const SHARE_DIR = path.join(__dirname, '..', 'uploads', 'share');
if (!fs.existsSync(SHARE_DIR)) {
  fs.mkdirSync(SHARE_DIR, { recursive: true });
}

// 100MB File Size Limit
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, SHARE_DIR);
  },
  filename: function (req, file, cb) {
    cb(null, 'share-' + Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

router.post('/upload', upload.single('file'), uploadFile);
router.get('/info/:shareId', getFileInfo);
router.get('/download/:shareId', downloadFile);

module.exports = router;
