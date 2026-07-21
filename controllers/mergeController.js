const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

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

exports.mergePdfs = async (req, res) => {
  if (!req.files || req.files.length < 2) {
    if (req.files) cleanupFiles(req.files.map(f => f.path));
    return res.status(400).json({ error: 'At least two PDF files required.' });
  }
  try {
    const mergedPdf = await PDFDocument.create();
    for (const file of req.files) {
      const pdfBytes = fs.readFileSync(file.path);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
    const mergedBytes = await mergedPdf.save();
    cleanupFiles(req.files.map((f) => f.path));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=merged.pdf');
    return res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error('PDF merge error:', err);
    if (req.files) cleanupFiles(req.files.map((f) => f.path));
    return res.status(500).json({ error: 'PDF merge failed.' });
  }
};
