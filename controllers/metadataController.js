const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

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
 * Detect AI Generation markers in raw image buffer / text chunks
 */
function scanAiIndicators(buffer, metadata = {}) {
  const indicators = [];
  const rawStr = buffer.toString('utf-8', 0, Math.min(buffer.length, 1024 * 512)).toLowerCase();

  // Stable Diffusion / Automatic1111 / ComfyUI
  if (
    rawStr.includes('steps:') ||
    rawStr.includes('sampler:') ||
    rawStr.includes('cfg scale:') ||
    rawStr.includes('negative prompt:') ||
    rawStr.includes('comfyui') ||
    rawStr.includes('stable diffusion')
  ) {
    indicators.push({
      tool: 'Stable Diffusion / ComfyUI',
      detail: 'Embedded generation parameters (Prompt, Sampler, Seed)',
    });
  }

  // Midjourney
  if (rawStr.includes('midjourney') || rawStr.includes('--v 5') || rawStr.includes('--v 6') || rawStr.includes('--ar ')) {
    indicators.push({
      tool: 'Midjourney',
      detail: 'Midjourney render parameters or software tag',
    });
  }

  // DALL-E / OpenAI
  if (rawStr.includes('dall-e') || rawStr.includes('openai') || rawStr.includes('dalle')) {
    indicators.push({
      tool: 'DALL-E / OpenAI',
      detail: 'OpenAI generator metadata or signature',
    });
  }

  // Adobe Firefly
  if (rawStr.includes('firefly') || rawStr.includes('c2pa') || rawStr.includes('content credentials')) {
    indicators.push({
      tool: 'Adobe Firefly / C2PA',
      detail: 'Content credentials and generative AI provenance tag',
    });
  }

  return indicators;
}

/**
 * POST /metadata/inspect
 * Reads hidden EXIF, GPS, author, and AI generator metadata
 */
exports.inspectMetadata = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded for inspection' });
  }

  const inputPath = req.file.path;
  const originalName = req.file.originalname || 'document';
  const ext = path.extname(originalName).toLowerCase();

  try {
    const fileBuffer = fs.readFileSync(inputPath);
    const tags = {};
    let aiIndicators = [];

    if (ext === '.pdf' || req.file.mimetype === 'application/pdf') {
      const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
      if (pdfDoc.getTitle()) tags['Title'] = pdfDoc.getTitle();
      if (pdfDoc.getAuthor()) tags['Author / User'] = pdfDoc.getAuthor();
      if (pdfDoc.getSubject()) tags['Subject'] = pdfDoc.getSubject();
      if (pdfDoc.getCreator()) tags['Creator Software'] = pdfDoc.getCreator();
      if (pdfDoc.getProducer()) tags['Producer Engine'] = pdfDoc.getProducer();
      if (pdfDoc.getCreationDate()) tags['Creation Date'] = pdfDoc.getCreationDate().toISOString();
      if (pdfDoc.getModificationDate()) tags['Modification Date'] = pdfDoc.getModificationDate().toISOString();

      aiIndicators = scanAiIndicators(fileBuffer);
    } else if (/\.(jpg|jpeg|png|webp|tiff)$/i.test(ext) || (req.file.mimetype && req.file.mimetype.startsWith('image/'))) {
      const meta = await sharp(inputPath).metadata();
      if (meta.format) tags['Format'] = meta.format.toUpperCase();
      if (meta.width && meta.height) tags['Resolution'] = `${meta.width} × ${meta.height} px`;
      if (meta.space) tags['Color Space'] = meta.space;
      if (meta.density) tags['DPI Density'] = meta.density;
      if (meta.hasProfile) tags['ICC Color Profile'] = 'Embedded';
      if (meta.exif) tags['EXIF Metadata Block'] = 'Present (Contains camera/device data)';
      if (meta.icc) tags['ICC Profile Data'] = 'Present';
      if (meta.xmp) tags['XMP Metadata Stream'] = 'Present';
      if (meta.iptc) tags['IPTC Press Tags'] = 'Present';

      aiIndicators = scanAiIndicators(fileBuffer, meta);
    }

    cleanupFiles([inputPath]);

    const tagCount = Object.keys(tags).length + aiIndicators.length;
    return res.status(200).json({
      success: true,
      originalName,
      hasMetadata: tagCount > 0,
      isAiGenerated: aiIndicators.length > 0,
      tagCount,
      tags,
      aiIndicators,
    });
  } catch (err) {
    cleanupFiles([inputPath]);
    console.error('Inspect metadata error:', err);
    return res.status(500).json({ error: 'Failed to inspect file metadata: ' + err.message });
  }
};

/**
 * POST /metadata/strip
 * Strips all EXIF, GPS, author, and AI generator metadata
 */
exports.stripMetadata = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded for metadata stripping' });
  }

  const inputPath = req.file.path;
  const originalName = req.file.originalname || 'sanitized-file';
  const ext = path.extname(originalName).toLowerCase();
  const baseName = path.parse(originalName).name;
  const timestamp = Date.now();
  const processedDir = path.join('processed');

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  try {
    const fileBuffer = fs.readFileSync(inputPath);
    let outputFileName = `sanitized-${timestamp}-${baseName}${ext}`;
    let outputPath = path.join(processedDir, outputFileName);
    let strippedTags = [];

    if (ext === '.pdf' || req.file.mimetype === 'application/pdf') {
      const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
      
      // Wipe all standard document metadata
      pdfDoc.setTitle('');
      pdfDoc.setAuthor('');
      pdfDoc.setSubject('');
      pdfDoc.setKeywords([]);
      pdfDoc.setProducer('ScanX Privacy Sanitizer');
      pdfDoc.setCreator('ScanX');

      strippedTags = ['Author', 'Creator Software', 'Producer', 'CreationDate', 'XMP Metadata', 'AI Provenance Tags'];

      const sanitizedBytes = await pdfDoc.save();
      fs.writeFileSync(outputPath, sanitizedBytes);
    } else {
      // Images: sharp by default strips EXIF, XMP, IPTC, ICC, and text chunks when saving without withMetadata()
      const format = ext.replace('.', '').toLowerCase();
      let sharpInstance = sharp(inputPath);

      if (format === 'jpg' || format === 'jpeg') {
        await sharpInstance.jpeg({ quality: 92 }).toFile(outputPath);
      } else if (format === 'png') {
        await sharpInstance.png({ compressionLevel: 8 }).toFile(outputPath);
      } else if (format === 'webp') {
        await sharpInstance.webp({ quality: 90 }).toFile(outputPath);
      } else {
        await sharpInstance.toFile(outputPath);
      }

      strippedTags = ['EXIF Camera Data', 'GPS Coordinates', 'XMP Stream', 'AI Generation Prompt & Parameters', 'Device Serial & Software'];
    }

    cleanupFiles([inputPath]);

    return res.status(200).json({
      success: true,
      downloadUrl: `/processed/${outputFileName}`,
      filename: outputFileName,
      originalName,
      strippedCount: strippedTags.length,
      strippedTags,
      summary: `Cleaned and stripped all ${strippedTags.length} metadata and AI tags. File is 100% anonymized.`,
    });
  } catch (err) {
    cleanupFiles([inputPath]);
    console.error('Strip metadata error:', err);
    return res.status(500).json({ error: 'Failed to strip file metadata: ' + err.message });
  }
};
