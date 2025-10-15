const { PDFDocument } = require('pdf-lib');

exports.mergePdfs = async (req, res) => {
  if (!req.files || req.files.length < 2) {
    return res.status(400).json({ error: 'At least two PDF files required.' });
  }
  try {
    const mergedPdf = await PDFDocument.create();
    for (const file of req.files) {
      const pdfBytes = require('fs').readFileSync(file.path);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
    const mergedBytes = await mergedPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=merged.pdf');
    res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error('PDF merge error:', err);
    res.status(500).json({ error: 'PDF merge failed.' });
  }
};
