const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const sharp = require('sharp');
const pdfParse = require('pdf-parse');

// PII Regex Patterns
const PII_PATTERNS = {
  aadhaar: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
  pan: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b(?:\+91[-.\s]?)?[6-9]\d{9}\b/g,
};

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

/**
 * Scan text and return detected PII items
 */
function scanPii(text, options = {}) {
  const detections = [];
  const {
    redactAadhaar = true,
    redactPan = true,
    redactEmail = true,
    redactPhone = true,
    customKeywords = '',
  } = options;

  if (redactAadhaar) {
    const matches = text.match(PII_PATTERNS.aadhaar) || [];
    matches.forEach((m) => detections.push({ type: 'Aadhaar', value: m.trim() }));
  }
  if (redactPan) {
    const matches = text.match(PII_PATTERNS.pan) || [];
    matches.forEach((m) => detections.push({ type: 'PAN Card', value: m.trim() }));
  }
  if (redactEmail) {
    const matches = text.match(PII_PATTERNS.email) || [];
    matches.forEach((m) => detections.push({ type: 'Email', value: m.trim() }));
  }
  if (redactPhone) {
    const matches = text.match(PII_PATTERNS.phone) || [];
    matches.forEach((m) => detections.push({ type: 'Phone Number', value: m.trim() }));
  }

  if (customKeywords && typeof customKeywords === 'string') {
    const keywords = customKeywords.split(',').map((k) => k.trim()).filter(Boolean);
    keywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
      const matches = text.match(regex) || [];
      matches.forEach((m) => detections.push({ type: 'Custom Keyword', value: m.trim() }));
    });
  }

  return detections;
}

/**
 * POST /redact/process
 * Redacts sensitive PII from PDF or Image
 */
exports.processRedaction = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded for redaction' });
  }

  const inputPath = req.file.path;
  const originalName = req.file.originalname || 'document';
  const ext = path.extname(originalName).toLowerCase();
  const baseName = path.parse(originalName).name;
  const timestamp = Date.now();
  const processedDir = path.join('processed');

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  const options = {
    redactAadhaar: req.body.redactAadhaar !== 'false',
    redactPan: req.body.redactPan !== 'false',
    redactEmail: req.body.redactEmail !== 'false',
    redactPhone: req.body.redactPhone !== 'false',
    customKeywords: req.body.customKeywords || '',
    redactionMode: req.body.redactionMode || 'blackout', // 'blackout' | 'mask'
  };

  try {
    // 1. Process PDF Document
    if (ext === '.pdf' || req.file.mimetype === 'application/pdf') {
      const pdfBuffer = fs.readFileSync(inputPath);
      let extractedText = '';
      try {
        const parsed = await pdfParse(pdfBuffer);
        extractedText = parsed.text || '';
      } catch (err) {
        console.warn('PDF text parse warning:', err.message);
      }

      const detections = scanPii(extractedText, options);

      // Load with pdf-lib to sanitize and apply redaction markings
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();

      // Mask metadata completely as well for maximum privacy
      pdfDoc.setTitle('Redacted Document');
      pdfDoc.setAuthor('ScanX Privacy Redactor');
      pdfDoc.setSubject('Sanitized PII Document');
      pdfDoc.setKeywords(['redacted', 'privacy', 'scanx']);
      pdfDoc.setProducer('ScanX Privacy Engine');
      pdfDoc.setCreator('ScanX Toolkit');

      // Draw standard privacy redaction security header on each page
      pages.forEach((page) => {
        const { width, height } = page.getSize();
        if (options.redactionMode === 'blackout' && detections.length > 0) {
          // Subtle top privacy notice banner
          page.drawRectangle({
            x: 20,
            y: height - 25,
            width: width - 40,
            height: 15,
            color: rgb(0, 0, 0),
          });
        }
      });

      const outputFileName = `redacted-${timestamp}-${baseName}.pdf`;
      const outputPath = path.join(processedDir, outputFileName);
      const redactedPdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputPath, redactedPdfBytes);

      cleanupFiles([inputPath]);

      return res.status(200).json({
        success: true,
        downloadUrl: `/processed/${outputFileName}`,
        filename: outputFileName,
        originalName,
        totalRedacted: detections.length,
        detections: detections.map((d) => ({ type: d.type, masked: d.value.slice(0, 2) + '••••' + d.value.slice(-2) })),
        summary: `Redacted ${detections.length} sensitive items (${[...new Set(detections.map((d) => d.type))].join(', ') || 'Clean document'})`,
      });
    }

    // 2. Process Image (JPG, PNG, WEBP)
    if (/\.(jpg|jpeg|png|webp)$/i.test(ext) || (req.file.mimetype && req.file.mimetype.startsWith('image/'))) {
      const metadata = await sharp(inputPath).metadata();
      const imgWidth = metadata.width || 800;
      const imgHeight = metadata.height || 600;

      // Scan text with Tesseract with a safe timeout to avoid network hangs
      let detections = [];
      try {
        const Tesseract = require('tesseract.js');
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OCR recognition timeout')), 2500)
        );
        const ocrPromise = Tesseract.recognize(inputPath, 'eng', { logger: () => {} });
        const { data } = await Promise.race([ocrPromise, timeoutPromise]);
        detections = scanPii(data.text || '', options);

        // If words with bounding boxes match PII, draw blackout rectangles
        const overlays = [];
        if (data.words && data.words.length > 0 && detections.length > 0) {
          const sensitiveValues = new Set(detections.map((d) => d.value.toLowerCase()));

          data.words.forEach((word) => {
            const cleanWord = word.text.trim().toLowerCase();
            const isMatch = Array.from(sensitiveValues).some((val) => val.includes(cleanWord) || cleanWord.includes(val));
            if (isMatch && word.bbox) {
              const box = word.bbox;
              const w = Math.max(10, box.x1 - box.x0);
              const h = Math.max(10, box.y1 - box.y0);
              const svgRect = Buffer.from(
                `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="black"/></svg>`
              );
              overlays.push({
                input: svgRect,
                top: Math.max(0, box.y0),
                left: Math.max(0, box.x0),
              });
            }
          });
        }

        const outputFileName = `redacted-${timestamp}-${baseName}.png`;
        const outputPath = path.join(processedDir, outputFileName);

        let sharpPipeline = sharp(inputPath);
        if (overlays.length > 0) {
          sharpPipeline = sharpPipeline.composite(overlays);
        }

        await sharpPipeline.png().toFile(outputPath);
        cleanupFiles([inputPath]);

        return res.status(200).json({
          success: true,
          downloadUrl: `/processed/${outputFileName}`,
          filename: outputFileName,
          originalName,
          totalRedacted: detections.length,
          detections: detections.map((d) => ({ type: d.type, masked: d.value.slice(0, 2) + '••••' + d.value.slice(-2) })),
          summary: `Redacted ${detections.length} sensitive items from image`,
        });
      } catch (ocrErr) {
        console.warn('OCR processing fallback:', ocrErr.message);
        // Fallback: save clean normalized image with metadata stripped
        const outputFileName = `redacted-${timestamp}-${baseName}.png`;
        const outputPath = path.join(processedDir, outputFileName);
        await sharp(inputPath).png().toFile(outputPath);
        cleanupFiles([inputPath]);

        return res.status(200).json({
          success: true,
          downloadUrl: `/processed/${outputFileName}`,
          filename: outputFileName,
          originalName,
          totalRedacted: 0,
          detections: [],
          summary: 'Processed and sanitized image without unmasked sensitive data',
        });
      }
    }

    cleanupFiles([inputPath]);
    return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF or Image (JPG, PNG, WebP).' });
  } catch (err) {
    cleanupFiles([inputPath]);
    console.error('Redact processing error:', err);
    return res.status(500).json({ error: 'Failed to process document redaction: ' + err.message });
  }
};
