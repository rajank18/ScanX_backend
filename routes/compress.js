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

router.post('/', upload.single('image'), compressImage);
router.post('/pdf', upload.single('file'), compressPdf);

module.exports = router;