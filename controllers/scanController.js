const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

// Helper for safe temp file cleanup
function cleanupFiles(filePaths) {
  filePaths.forEach((filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('File cleanup error:', err);
      }
    }
  });
}

exports.scanImage = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const inputPath = req.file.path;
  const baseName = path.parse(req.file.filename).name;
  const outputFileName = `scanned-${baseName}.png`;
  const outputPath = path.join('processed', outputFileName);

  try {
    // 1. Ensure output folder exists
    const processedDir = path.join('processed');
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
    }

    // 2. High-Quality "CamScanner" Filter Effect
    // - grayscale: Removes color noise/stains
    // - normalize: Stretches contrast across entire dynamic range
    // - modulate: Brightens white backgrounds while making dark text pop
    // - sharpen: Defines text edges for high readability
    await sharp(inputPath)
      .grayscale()
      .normalize()
      .modulate({
        brightness: 1.08, // Brightens paper background
        contrast: 1.25,   // Darkens pen/printed ink
      })
      .sharpen({
        sigma: 1.2,
        m1: 1.0,
        m2: 2.0,
      })
      .png()
      .toFile(outputPath);

    // 3. Output as PDF
    if (req.body && req.body.format === 'pdf') {
      try {
        const imgBytes = fs.readFileSync(outputPath);
        const pdfDoc = await PDFDocument.create();
        const img = await pdfDoc.embedPng(imgBytes);

        const page = pdfDoc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

        const pdfBytes = await pdfDoc.save();

        // Clean up both input and processed PNG files after PDF stream
        cleanupFiles([inputPath, outputPath]);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=scanned.pdf');
        return res.send(Buffer.from(pdfBytes));
      } catch (err) {
        console.error('PDF generation error:', err);
        cleanupFiles([inputPath, outputPath]);
        return res.status(500).json({ error: 'PDF generation failed' });
      }
    }

    // 4. Output as PNG
    return res.sendFile(path.resolve(outputPath), () => {
      cleanupFiles([inputPath, outputPath]);
    });

  } catch (error) {
    console.error('CamScanner processing error:', error);
    cleanupFiles([inputPath, outputPath]);
    return res.status(500).json({ error: 'Error processing image' });
  }
};

exports.compressImage = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const inputPath = req.file.path;

  try {
    const targetSizeKB = parseInt(req.body.targetSize, 10) || 200;
    const targetSizeBytes = targetSizeKB * 1024;

    let minQuality = 10;
    let maxQuality = 95;
    let bestBuffer = null;
    let quality = 80;

    // Binary search for exact JPEG quality under target file size
    for (let i = 0; i < 5; i++) {
      quality = Math.floor((minQuality + maxQuality) / 2);

      const tempBuffer = await sharp(inputPath)
        .jpeg({
          quality,
          progressive: true,
          mozjpeg: true,
        })
        .toBuffer();

      if (tempBuffer.length <= targetSizeBytes) {
        bestBuffer = tempBuffer;
        minQuality = quality + 1; // Try higher quality
      } else {
        maxQuality = quality - 1; // Needs more compression
      }
    }

    // If still over budget at lowest quality threshold, scale dimensions down
    if (!bestBuffer || bestBuffer.length > targetSizeBytes) {
      const metadata = await sharp(inputPath).metadata();
      const currentBuffer = bestBuffer || (await sharp(inputPath).jpeg({ quality: 20 }).toBuffer());
      const scale = Math.sqrt(targetSizeBytes / currentBuffer.length) * 0.95;

      const newWidth = Math.max(Math.floor((metadata.width || 800) * scale), 150);

      bestBuffer = await sharp(inputPath)
        .resize({ width: newWidth, fit: 'inside' })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
    }

    cleanupFiles([inputPath]);

    res.type('image/jpeg').send(bestBuffer);
  } catch (error) {
    console.error('Compression error:', error);
    cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Compression failed' });
  }
};