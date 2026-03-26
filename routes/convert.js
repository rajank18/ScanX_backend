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
const docxToPdf = require('docx2pdf-converter');
const spirePdf = require('spire.pdf');
const XLSX = require('xlsx');
const { jsPDF } = require('jspdf');
const autoTableModule = require('jspdf-autotable');

const autoTable = autoTableModule.default || autoTableModule;
const execFileAsync = promisify(execFile);
const fsp = fs.promises;

const upload = multer({ dest: path.join(__dirname, '../uploads/') });
const processedDir = path.join(__dirname, '../processed');

function safeUnlink(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

function scheduleDelete(filePath, delayMs = 60 * 1000) {
  setTimeout(() => safeUnlink(filePath), delayMs);
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
    FileList: class FileList {},
    HTMLFormElement: class HTMLFormElement {},
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
      const image = isPng
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);

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

router.post('/word-to-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No Word file uploaded');
  }

  const outputPath = path.join(processedDir, `word-to-pdf-${Date.now()}.pdf`);
  try {
    await Promise.resolve(docxToPdf.convert(req.file.path, outputPath));
    return sendFileAndCleanup(res, outputPath, [req.file.path]);
  } catch (error) {
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert Word to PDF (docx2pdf-converter requires local office tools)');
  }
});

router.post('/pdf-to-word', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No PDF uploaded');
  }

  const convertApiSecret = process.env.CONVERTAPI_SECRET;
  if (!convertApiSecret) {
    safeUnlink(req.file.path);
    return res.status(500).send('Missing CONVERTAPI_SECRET environment variable');
  }

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

    if (!result.files || !result.files[0] || !result.files[0].Url) {
      throw new Error('No DOCX file returned by ConvertAPI');
    }

    const response = await fetch(result.files[0].Url);
    if (!response.ok) {
      throw new Error('Failed to download converted DOCX');
    }

    const docxBuffer = Buffer.from(await response.arrayBuffer());
    const outputPath = path.join(processedDir, `pdf-to-word-${Date.now()}.docx`);
    await fsp.writeFile(outputPath, docxBuffer);
    return sendFileAndCleanup(res, outputPath, [req.file.path]);
  } catch (error) {
    safeUnlink(req.file.path);
    return res.status(500).send('Failed to convert PDF to Word via convertapi-js');
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
      return res.status(400).send('Excel file has no sheets');
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    const [headerRow = []] = rows;
    const bodyRows = rows.length > 1 ? rows.slice(1) : [];

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`Sheet: ${firstSheetName}`, 40, 40);

    autoTable(doc, {
      head: [headerRow.map((value) => String(value ?? ''))],
      body: bodyRows.map((row) => row.map((value) => String(value ?? ''))),
      startY: 60,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [33, 150, 243] },
    });

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
    // Keep spire.pdf in this conversion path per requested stack.
    const _spireLoaded = !!spirePdf;

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

module.exports = router;
