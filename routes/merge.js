const express = require('express');
const multer = require('multer');
const { mergePdfs } = require('../controllers/mergeController');
const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
const upload = multer({ storage });

router.post('/merge', upload.array('pdfs', 20), mergePdfs);

module.exports = router;
