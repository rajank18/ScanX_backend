const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const upload = multer({ dest: path.join(__dirname, '../uploads/') });

// POST /convert/image-to-pdf
router.post('/image-to-pdf', upload.array('images'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send('No images uploaded');
    }
    // Create PDF
    const doc = new PDFDocument({ autoFirstPage: false });
    const pdfPath = path.join(__dirname, '../processed', `image-to-pdf-${Date.now()}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    for (const file of req.files) {
      const imgPath = file.path;
      const image = doc.openImage(imgPath);
      doc.addPage({ size: [image.width, image.height] });
      doc.image(imgPath, 0, 0, { width: image.width, height: image.height });
    }

    doc.end();
    stream.on('finish', () => {
      res.sendFile(pdfPath, () => {
        // Optionally delete after sending
        setTimeout(() => fs.unlink(pdfPath, () => {}), 60000);
        req.files.forEach(f => fs.unlink(f.path, () => {}));
      });
    });
  } catch (err) {
    res.status(500).send('Failed to convert images to PDF');
  }
});

module.exports = router;
