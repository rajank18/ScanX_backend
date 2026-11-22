const express = require('express');
const multer = require('multer');
const path = require('path');
const { processRedaction } = require('../controllers/redactController');

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, 'redact-' + Date.now() + '-' + file.originalname);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.post('/process', upload.single('file'), processRedaction);
router.post('/', upload.single('file'), processRedaction);

module.exports = router;
