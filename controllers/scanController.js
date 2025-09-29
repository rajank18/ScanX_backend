const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

exports.scanImage = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const inputPath = req.file.path;
    const baseName = path.parse(req.file.filename).name; // strip original extension
    const outputFileName = 'scanned-' + baseName + '.png';
    const outputPath = path.join('processed', outputFileName);

    await sharp(inputPath)
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toFile(outputPath);

    if (req.body && req.body.format === 'pdf') {
      const pdfDoc = await PDFDocument.create();
      const imgBytes = fs.readFileSync(outputPath);
      const img = await pdfDoc.embedPng(imgBytes);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=scanned.pdf');
      return res.send(Buffer.from(pdfBytes));
    }

    return res.sendFile(path.resolve(outputPath));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error processing image' });
  }
};

exports.compressImage = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const inputPath = req.file.path;
    const targetSizeKB = parseInt(req.body.targetSize) || 200;
    const targetSizeBytes = targetSizeKB * 1024;
    const quality = parseInt(req.body.quality) || 70;

    let currentQuality = Math.min(quality, 90);
    let buffer;
    let attempts = 0;
    const maxAttempts = 5;

    do {
      buffer = await sharp(inputPath)
        .jpeg({
          quality: currentQuality,
          progressive: true,
          mozjpeg: true,
        })
        .toBuffer();

      attempts++;
      if (buffer.length <= targetSizeBytes || attempts >= maxAttempts) break;

      currentQuality = Math.max(currentQuality - 10, 10);
    } while (attempts < maxAttempts);

    // If still too large after max attempts, resize proportionally
    if (buffer.length > targetSizeBytes) {
      const metadata = await sharp(inputPath).metadata();
      const scale = Math.sqrt((targetSizeBytes * 0.75) / (metadata.width * metadata.height)); // Approximate
      const newWidth = Math.max(Math.floor(metadata.width * scale), 100);
      const newHeight = Math.floor(metadata.height * scale);

      buffer = await sharp(inputPath)
        .resize(newWidth, newHeight)
        .jpeg({ quality: 70 })
        .toBuffer();
    }

    fs.unlinkSync(inputPath); // Clean up temp file

    res.type('image/jpeg').send(buffer);
  } catch (error) {
    console.error('Compression error:', error);
    if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Compression failed' });
  }
};
