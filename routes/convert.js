const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { PDFDocument: PDFLibDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
} = require('docx');

const upload = multer({ dest: path.join(__dirname, '../uploads/') });

const processedDir = path.join(__dirname, '../processed');

function scheduleDelete(filePath, delayMs = 60 * 1000) {
  setTimeout(() => {
    fs.unlink(filePath, () => {});
  }, delayMs);
}

function safeUnlink(filePath) {
  fs.unlink(filePath, () => {});
}

async function cleanupFiles(files = []) {
  await Promise.all(
    files.filter(Boolean).map(async (filePath) => {
      try {
        await fsp.unlink(filePath);
      } catch (error) {
        // Ignore cleanup errors for temporary files.
      }
    })
  );
}

function createTextPdf({ title, lines, outputPath }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    doc.fontSize(18).text(title);
    doc.moveDown();
    doc.fontSize(11);

    lines.forEach((line) => {
      doc.text(line || ' ');
    });

    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// POST /convert/image-to-pdf
router.post('/image-to-pdf', upload.array('images'), async (req, res) => {
  const uploadedFiles = req.files || [];
  try {
    if (uploadedFiles.length === 0) {
      return res.status(400).send('No images uploaded');
    }

    // Create PDF
    const doc = new PDFDocument({ autoFirstPage: false });
    const pdfPath = path.join(processedDir, `image-to-pdf-${Date.now()}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    for (const file of uploadedFiles) {
      const imgPath = file.path;
      const image = doc.openImage(imgPath);
      doc.addPage({ size: [image.width, image.height] });
      doc.image(imgPath, 0, 0, { width: image.width, height: image.height });
    }

    doc.end();
    stream.on('finish', () => {
      res.sendFile(pdfPath, () => {
        scheduleDelete(pdfPath);
        uploadedFiles.forEach((f) => safeUnlink(f.path));
      });
    });
    stream.on('error', () => {
      uploadedFiles.forEach((f) => safeUnlink(f.path));
      res.status(500).send('Failed to write PDF output');
    });
  } catch (err) {
    uploadedFiles.forEach((f) => safeUnlink(f.path));
    res.status(500).send('Failed to convert images to PDF');
  }
});

// POST /convert/jpg-to-png
router.post('/jpg-to-png', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image uploaded');
  }

  const outputPath = path.join(processedDir, `jpg-to-png-${Date.now()}.png`);

  try {
    await sharp(req.file.path).png().toFile(outputPath);
    return res.sendFile(outputPath, () => {
      safeUnlink(req.file.path);
      scheduleDelete(outputPath);
    });
  } catch (error) {
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert JPG to PNG');
  }
});

// POST /convert/png-to-jpg
router.post('/png-to-jpg', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image uploaded');
  }

  const outputPath = path.join(processedDir, `png-to-jpg-${Date.now()}.jpg`);

  try {
    await sharp(req.file.path)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    return res.sendFile(outputPath, () => {
      safeUnlink(req.file.path);
      scheduleDelete(outputPath);
    });
  } catch (error) {
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert PNG to JPG');
  }
});

// POST /convert/pdf-to-text
router.post('/pdf-to-text', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }

  try {
    const pdfBuffer = await fsp.readFile(req.file.path);
    const parsed = await pdfParse(pdfBuffer);
    return res.json({ text: parsed.text || '' });
  } catch (error) {
    return res.status(500).send('Failed to extract text from PDF');
  } finally {
    safeUnlink(req.file.path);
  }
});

// POST /convert/pdf-to-images
router.post('/pdf-to-images', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }

  try {
    const pdfBuffer = await fsp.readFile(req.file.path);
    const pdfDoc = await PDFLibDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();

    if (pageCount === 0) {
      return res.status(400).send('PDF has no pages');
    }

    const outputs = [];
    for (let page = 0; page < pageCount; page += 1) {
      const outputName = `pdf-page-${Date.now()}-${page + 1}.png`;
      const outputPath = path.join(processedDir, outputName);

      await sharp(req.file.path, { page, density: 180 }).png().toFile(outputPath);
      outputs.push(outputName);
      scheduleDelete(outputPath);
    }

    const imageBase = `${req.protocol}://${req.get('host')}/processed`;
    return res.json({
      images: outputs.map((name) => `${imageBase}/${name}`),
    });
  } catch (error) {
    return res.status(500).send('Failed to convert PDF to images');
  } finally {
    safeUnlink(req.file.path);
  }
});

// POST /convert/word-to-pdf
router.post('/word-to-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No Word file uploaded');
  }

  const ext = path.extname(req.file.originalname || '').toLowerCase();
  if (ext !== '.docx') {
    safeUnlink(req.file.path);
    return res.status(400).send('Only .docx is supported for Word to PDF conversion');
  }

  const outputPath = path.join(processedDir, `word-to-pdf-${Date.now()}.pdf`);

  try {
    const result = await mammoth.extractRawText({ path: req.file.path });
    const lines = (result.value || '').split(/\r?\n/);
    await createTextPdf({
      title: req.file.originalname || 'Word Document',
      lines,
      outputPath,
    });

    return res.sendFile(outputPath, () => {
      safeUnlink(req.file.path);
      scheduleDelete(outputPath);
    });
  } catch (error) {
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert Word to PDF');
  }
});

// POST /convert/pdf-to-word
router.post('/pdf-to-word', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }

  const outputPath = path.join(processedDir, `pdf-to-word-${Date.now()}.docx`);

  try {
    const pdfBuffer = await fsp.readFile(req.file.path);
    const parsed = await pdfParse(pdfBuffer);
    const lines = (parsed.text || '').split(/\r?\n/);

    const paragraphs = lines.map((line) =>
      new Paragraph({
        children: [new TextRun(line || ' ')],
      })
    );

    const doc = new Document({
      sections: [{ children: paragraphs }],
    });

    const buffer = await Packer.toBuffer(doc);
    await fsp.writeFile(outputPath, buffer);

    return res.sendFile(outputPath, () => {
      safeUnlink(req.file.path);
      scheduleDelete(outputPath);
    });
  } catch (error) {
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert PDF to Word');
  }
});

// POST /convert/excel-to-pdf
router.post('/excel-to-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No Excel file uploaded');
  }

  const outputPath = path.join(processedDir, `excel-to-pdf-${Date.now()}.pdf`);

  try {
    const workbook = XLSX.readFile(req.file.path);
    const [firstSheetName] = workbook.SheetNames;

    if (!firstSheetName) {
      return res.status(400).send('Excel file has no sheets');
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

    const lines = rows.map((row) =>
      row
        .map((cell) => (cell === undefined || cell === null ? '' : String(cell)))
        .join(' | ')
    );

    await createTextPdf({
      title: `Sheet: ${firstSheetName}`,
      lines,
      outputPath,
    });

    return res.sendFile(outputPath, () => {
      safeUnlink(req.file.path);
      scheduleDelete(outputPath);
    });
  } catch (error) {
    return res.status(500).send('Failed to convert Excel to PDF');
  } finally {
    safeUnlink(req.file.path);
  }
});

// POST /convert/pdf-to-excel
router.post('/pdf-to-excel', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }

  const outputPath = path.join(processedDir, `pdf-to-excel-${Date.now()}.xlsx`);

  try {
    const pdfBuffer = await fsp.readFile(req.file.path);
    const parsed = await pdfParse(pdfBuffer);
    const lines = (parsed.text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const rows = lines.map((line) => [line]);
    if (rows.length === 0) {
      rows.push(['']);
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Extracted Text');
    XLSX.writeFile(workbook, outputPath);

    return res.sendFile(outputPath, () => {
      safeUnlink(req.file.path);
      scheduleDelete(outputPath);
    });
  } catch (error) {
    return res.status(500).send('Failed to convert PDF to Excel');
  } finally {
    safeUnlink(req.file.path);
  }
});

module.exports = router;
