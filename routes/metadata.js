const express = require('express');
const multer = require('multer');
const path = require('path');
const { inspectMetadata, stripMetadata } = require('../controllers/metadataController');

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, 'meta-' + Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.post('/inspect', upload.single('file'), inspectMetadata);
router.post('/strip', upload.single('file'), stripMetadata);

module.exports = router;
