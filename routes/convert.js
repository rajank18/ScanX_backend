const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const PDFDocumentKit = require('pdfkit');
const sharp = require('sharp');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const execFileAsync = promisify(execFile);
const XLSX = require('xlsx');
const { jsPDF } = require('jspdf');
const autoTableModule = require('jspdf-autotable');

const autoTable = autoTableModule.default || autoTableModule;
const fsp = fs.promises;

const upload = multer({ dest: path.join(__dirname, '../uploads/') });
const processedDir = path.join(__dirname, '../processed');

function safeUnlink(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => { });
}

function scheduleDelete(filePath, delayMs = 60 * 1000) {
  const timer = setTimeout(() => safeUnlink(filePath), delayMs);
  if (timer.unref) timer.unref();
}

function sendFileAndCleanup(res, outputPath, tempFiles = []) {
  return res.sendFile(outputPath, () => {
    tempFiles.forEach((filePath) => safeUnlink(filePath));
    scheduleDelete(outputPath);
  });
}

function loadConvertApiNamespace() {
  const convertApiPath = require.resolve('convertapi-js/lib/convertapi.js');
  const code = fs.readFileSync(convertApiPath, 'utf8');

  const sandbox = {
    module: { exports: {} },
    exports: {},
    fetch,
    URL,
    File,
    FileList: class FileList { },
    HTMLFormElement: class HTMLFormElement { },
    FormData,
    console,
  };

  vm.runInNewContext(`${code}\nmodule.exports = ConvertApi;`, sandbox);
  return sandbox.module.exports;
}

async function trySpirePdfToExcel(inputPath, outputPath) {
  // Run Spire in a child process to avoid crashing the API process on native runtime aborts.
  const runnerPath = path.join(processedDir, `spire-runner-${Date.now()}.js`);
  const script = [
    "const sp = require('spire.pdf');",
    'const input = process.argv[2];',
    'const output = process.argv[3];',
    'try {',
    '  const doc = sp._PdfDocument_Create();',
    '  sp._PdfDocument_LoadFromFile(doc, input);',
    '  sp._PdfDocument_SaveToFile(doc, output);',
    '  process.exit(0);',
    '} catch (error) {',
    '  process.exit(1);',
    '}',
  ].join('\n');

  await fsp.writeFile(runnerPath, script, 'utf8');
  try {
    await execFileAsync(process.execPath, [runnerPath, inputPath, outputPath], {
      cwd: path.join(__dirname, '..'),
    });
    return true;
  } catch (error) {
    return false;
  } finally {
    safeUnlink(runnerPath);
  }
}

router.post('/image-to-pdf', upload.array('images'), async (req, res) => {
  const uploadedFiles = req.files || [];
  if (uploadedFiles.length === 0) {
    return res.status(400).send('No images uploaded');
  }

  try {
    const pdfDoc = await PDFDocument.create();

    for (const file of uploadedFiles) {
      const bytes = await fsp.readFile(file.path);
      const isPng = file.mimetype === 'image/png' || file.originalname.toLowerCase().endsWith('.png');
      let image;
      try {
        image = isPng
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
      } catch (embedErr) {
        // Fallback: convert any image format (WebP, AVIF, TIFF, BMP, GIF) to standard PNG bytes
        const safePngBytes = await sharp(bytes).png().toBuffer();
        image = await pdfDoc.embedPng(safePngBytes);
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    const outputPath = path.join(processedDir, `image-to-pdf-${Date.now()}.pdf`);
    const pdfBytes = await pdfDoc.save();
    await fsp.writeFile(outputPath, Buffer.from(pdfBytes));
    return sendFileAndCleanup(res, outputPath, uploadedFiles.map((f) => f.path));
  } catch (error) {
    uploadedFiles.forEach((f) => safeUnlink(f.path));
    return res.status(500).send('Failed to convert images to PDF');
  }
});

router.post('/pdf-to-images', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }
  safeUnlink(req.file.path);
  return res.status(400).send('PDF to Images now runs client-side with pdf.js');
});

router.post('/jpg-to-png', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image uploaded');
  }
  safeUnlink(req.file.path);
  return res.status(400).send('JPG to PNG now runs client-side with browser-image-converter');
});

router.post('/png-to-jpg', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image uploaded');
  }
  safeUnlink(req.file.path);
  return res.status(400).send('PNG to JPG now runs client-side with browser-image-converter');
});

router.post('/pdf-to-text', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }

  try {
    const buffer = await fsp.readFile(req.file.path);
    const parsed = await pdfParse(buffer);
    return res.json({ text: parsed.text || '' });
  } catch (error) {
    return res.status(500).send('Failed to extract text from PDF');
  } finally {
    safeUnlink(req.file.path);
  }
});

async function convertWordToPdfLocal(filePath) {
  const textResult = await mammoth.extractRawText({ path: filePath });
  const text = textResult.value || '';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocumentKit({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const lines = text.split('\n');
    if (lines.length === 0 || !text.trim()) {
      doc.fontSize(12).text('Empty document');
    } else {
      lines.forEach((line) => {
        if (!line.trim()) {
          doc.moveDown(0.5);
        } else {
          doc.fontSize(11).text(line, { align: 'left' });
        }
      });
    }
    doc.end();
  });
}

router.post("/word-to-pdf", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No Word file uploaded");
  }

  const outputPath = path.join(
    processedDir,
    `word-to-pdf-${Date.now()}.pdf`
  );

  try {
    const convertApiSecret = process.env.CONVERTAPI_SECRET;
    if (convertApiSecret) {
      try {
        const ConvertApi = loadConvertApiNamespace();
        const convertApi = ConvertApi.auth({ secret: convertApiSecret });
        const params = convertApi.createParams();
        const fileBuffer = await fsp.readFile(req.file.path);
        const uploadFile = new File([fileBuffer], req.file.originalname || 'input.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        params.add('file', uploadFile);
        const result = await convertApi.convert('docx', 'pdf', params);

        if (result.files && result.files[0] && result.files[0].Url) {
          const apiRes = await fetch(result.files[0].Url);
          if (apiRes.ok) {
            const pdfBuf = Buffer.from(await apiRes.arrayBuffer());
            await fsp.writeFile(outputPath, pdfBuf);
            return sendFileAndCleanup(res, outputPath, [req.file.path]);
          }
        }
      } catch (cloudErr) {
        console.warn("ConvertAPI failed, falling back to local converter:", cloudErr.message);
      }
    }

    const pdfBuffer = await convertWordToPdfLocal(req.file.path);
    await fsp.writeFile(outputPath, pdfBuffer);
    return sendFileAndCleanup(res, outputPath, [req.file.path]);
  } catch (err) {
    console.error("Word to PDF error:", err);
    safeUnlink(req.file.path);
    return res.status(500).send("Failed to convert Word to PDF");
  }
});

async function convertPdfToWordLocal(filePath) {
  const buffer = await fsp.readFile(filePath);
  const parsed = await pdfParse(buffer);
  const lines = (parsed.text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children:
          lines.length > 0
            ? lines.map(
                (line) =>
                  new Paragraph({
                    children: [new TextRun({ text: line, size: 24 })],
                  })
              )
            : [
                new Paragraph({
                  children: [new TextRun({ text: 'Empty Document', size: 24 })],
                }),
              ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

router.post('/pdf-to-word', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }

  const outputPath = path.join(processedDir, `pdf-to-word-${Date.now()}.docx`);
  const convertApiSecret = process.env.CONVERTAPI_SECRET;

  if (convertApiSecret) {
    try {
      const ConvertApi = loadConvertApiNamespace();
      const convertApi = ConvertApi.auth({ secret: convertApiSecret });
      const params = convertApi.createParams();
      const fileBuffer = await fsp.readFile(req.file.path);
      const uploadFile = new File([fileBuffer], req.file.originalname || 'input.pdf', {
        type: 'application/pdf',
      });

      params.add('file', uploadFile);
      const result = await convertApi.convert('pdf', 'docx', params);

      if (result.files && result.files[0] && result.files[0].Url) {
        const response = await fetch(result.files[0].Url);
        if (response.ok) {
          const docxBuffer = Buffer.from(await response.arrayBuffer());
          await fsp.writeFile(outputPath, docxBuffer);
          return sendFileAndCleanup(res, outputPath, [req.file.path]);
        }
      }
    } catch (cloudErr) {
      console.warn('ConvertAPI failed, falling back to local docx generator:', cloudErr.message);
    }
  }

  // Resilient offline fallback: extracts PDF text and generates DOCX locally
  try {
    const docxBuffer = await convertPdfToWordLocal(req.file.path);
    await fsp.writeFile(outputPath, docxBuffer);
    return sendFileAndCleanup(res, outputPath, [req.file.path]);
  } catch (error) {
    console.error('Local PDF to Word conversion failed:', error);
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert PDF to Word');
  }
});

router.post('/excel-to-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No Excel file uploaded');
  }

  const outputPath = path.join(processedDir, `excel-to-pdf-${Date.now()}.pdf`);

  try {
    const workbook = XLSX.readFile(req.file.path, { cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      safeUnlink(req.file.path);
      return res.status(400).send('Excel file has no sheets');
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    const [headerRow = []] = rows;
    const bodyRows = rows.length > 1 ? rows.slice(1) : [];

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`Sheet: ${firstSheetName}`, 40, 40);

    if (rows.length === 0 || (headerRow.length === 0 && bodyRows.length === 0)) {
      doc.setFontSize(10);
      doc.text('This sheet contains no tabular data.', 40, 70);
    } else {
      autoTable(doc, {
        head: headerRow.length > 0 ? [headerRow.map((value) => String(value ?? ''))] : undefined,
        body: bodyRows.map((row) => (Array.isArray(row) ? row.map((value) => String(value ?? '')) : [String(row ?? '')])),
        startY: 60,
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [33, 150, 243] },
      });
    }

    const pdfBytes = Buffer.from(doc.output('arraybuffer'));
    await fsp.writeFile(outputPath, pdfBytes);
    return sendFileAndCleanup(res, outputPath, [req.file.path]);
  } catch (error) {
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert Excel to PDF');
  }
});

router.post('/pdf-to-excel', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }

  const outputPath = path.join(processedDir, `pdf-to-excel-${Date.now()}.xlsx`);

  try {
    const spireSucceeded = await trySpirePdfToExcel(req.file.path, outputPath);
    if (!spireSucceeded) {
      const buffer = await fsp.readFile(req.file.path);
      const parsed = await pdfParse(buffer);
      const lines = (parsed.text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(lines.map((line) => [line]));
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Extracted Text');
      XLSX.writeFile(workbook, outputPath);
    }

    return sendFileAndCleanup(res, outputPath, [req.file.path]);
  } catch (error) {
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert PDF to Excel');
  }
});

const { fetchNotebookContent, convertNotebookToPdfBuffer } = require('../services/notebookPdfService');

router.post('/colab-to-pdf', upload.single('file'), async (req, res) => {
  let content = '';
  let filename = 'notebook.ipynb';
  const tempFilesToClean = [];

  try {
    if (req.file) {
      tempFilesToClean.push(req.file.path);
      content = await fsp.readFile(req.file.path, 'utf8');
      filename = req.file.originalname || filename;
    } else {
      const url = req.body?.url;
      if (!url || typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({ error: 'Please provide a Google Colab / GitHub URL or upload a notebook file.' });
      }
      content = await fetchNotebookContent(url.trim());
      const urlClean = url.split('?')[0];
      const basename = path.basename(urlClean);
      if (basename && (basename.endsWith('.ipynb') || basename.endsWith('.py'))) {
        filename = basename;
      }
    }

    const pdfBuffer = await convertNotebookToPdfBuffer(content, { filename });
    const outputFilename = `${path.parse(filename).name || 'notebook'}.pdf`;

    tempFilesToClean.forEach((p) => safeUnlink(p));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    return res.send(pdfBuffer);
  } catch (error) {
    tempFilesToClean.forEach((p) => safeUnlink(p));
    return res.status(400).json({ error: error.message || 'Failed to convert notebook to PDF' });
  }
});

module.exports = router;
