const PDFDocumentKit = require('pdfkit');

/**
 * Resolves various Google Colab, Google Drive, and GitHub URL formats
 * into direct raw downloadable file links.
 */
function resolveNotebookUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const url = rawUrl.trim();

  // 1. Google Colab Drive link: https://colab.research.google.com/drive/1xxxxxx
  const colabDriveMatch = url.match(/colab\.research\.google\.com\/drive\/([a-zA-Z0-9_-]+)/i);
  if (colabDriveMatch) {
    const fileId = colabDriveMatch[1];
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  // 2. Google Drive share link: https://drive.google.com/file/d/1xxxxxx/view...
  const gdriveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (gdriveMatch) {
    const fileId = gdriveMatch[1];
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  // 3. Google Colab GitHub link: https://colab.research.google.com/github/owner/repo/blob/branch/file.ipynb
  const colabGhMatch = url.match(/colab\.research\.google\.com\/github\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/i);
  if (colabGhMatch) {
    const [, owner, repo, branch, filePath] = colabGhMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  // 4. Standard GitHub blob link: https://github.com/owner/repo/blob/branch/file.ipynb
  const ghBlobMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/i);
  if (ghBlobMatch) {
    const [, owner, repo, branch, filePath] = ghBlobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  return url;
}

/**
 * Fetches the raw content of the notebook from the resolved URL.
 */
async function fetchNotebookContent(url) {
  const resolvedUrl = resolveNotebookUrl(url);
  if (!resolvedUrl) {
    throw new Error('Please provide a valid Google Colab, GitHub, or notebook URL.');
  }

  const response = await fetch(resolvedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ScanX/1.0',
      'Accept': 'application/json, text/plain, */*',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch notebook file (HTTP ${response.status}: ${response.statusText})`);
  }

  const text = await response.text();

  // Check if Google Drive returned a private login page
  if (text.includes('<!DOCTYPE html>') && (text.includes('accounts.google.com') || text.includes('Google Drive - Access Denied'))) {
    throw new Error('This Google Drive / Colab notebook is private. Please set link sharing to "Anyone with the link can view", or upload the .ipynb file directly.');
  }

  return text;
}

/**
 * Converts .ipynb JSON or .py code into a styled PDF Buffer using PDFKit.
 */
async function convertNotebookToPdfBuffer(rawContent, options = {}) {
  const filename = options.filename || 'notebook.ipynb';

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocumentKit({
        size: 'A4',
        margin: 40,
        bufferPages: true,
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      let isNotebook = false;
      let notebookData = null;

      try {
        const parsed = JSON.parse(rawContent);
        if (parsed && Array.isArray(parsed.cells)) {
          isNotebook = true;
          notebookData = parsed;
        }
      } catch (e) {
        isNotebook = false;
      }

      const displayTitle = (isNotebook && notebookData.metadata?.colab?.name)
        ? notebookData.metadata.colab.name
        : filename;

      // Draw Notebook Header Banner
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#0F172A').text(displayTitle);
      doc.moveDown(0.2);
      doc.fontSize(9).font('Helvetica').fillColor('#64748B')
        .text(`Google Colab Notebook • Converted with ScanX • ${new Date().toLocaleDateString()}`);
      doc.moveDown(0.4);

      // Horizontal divider
      doc.strokeColor('#E2E8F0').lineWidth(1)
        .moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(0.8);

      if (isNotebook) {
        renderIpynbCells(doc, notebookData.cells);
      } else {
        renderPythonScript(doc, rawContent);
      }

      // Add page numbers on all buffered pages without triggering bottom margin overflow
      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i++) {
        doc.switchToPage(i);
        const originalBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.fontSize(8).font('Helvetica').fillColor('#94A3B8')
          .text(
            `Page ${i + 1} of ${pageRange.count}`,
            40,
            doc.page.height - 25,
            { align: 'center', width: doc.page.width - 80, lineBreak: false }
          );
        doc.page.margins.bottom = originalBottom;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderIpynbCells(doc, cells) {
  const contentWidth = doc.page.width - 80;

  cells.forEach((cell) => {
    const sourceText = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    if (!sourceText.trim()) return;

    // Ensure room before cell
    if (doc.y > doc.page.height - 80) {
      doc.addPage();
    }

    if (cell.cell_type === 'markdown') {
      renderMarkdownCell(doc, sourceText, contentWidth);
    } else if (cell.cell_type === 'code') {
      renderCodeCell(doc, cell, sourceText, contentWidth);
    }

    doc.moveDown(0.5);
  });
}

function renderMarkdownCell(doc, text, contentWidth) {
  const lines = text.split('\n');

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      doc.moveDown(0.3);
      return;
    }

    if (trimmed.startsWith('# ')) {
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#0F172A').text(trimmed.replace(/^#\s+/, ''));
    } else if (trimmed.startsWith('## ')) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1E293B').text(trimmed.replace(/^##\s+/, ''));
    } else if (trimmed.startsWith('### ')) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#334155').text(trimmed.replace(/^###\s+/, ''));
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      doc.fontSize(9.5).font('Helvetica').fillColor('#334155').text(`  •  ${trimmed.slice(2)}`, { indent: 10 });
    } else {
      doc.fontSize(9.5).font('Helvetica').fillColor('#334155').text(trimmed);
    }
  });
}

function cleanOutputText(str) {
  if (!str) return '';
  return str
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\[\??[0-9;]+[a-zA-Z]/g, '')
    .replace(/\[[0-9]{1,2}m/g, '')
    .replace(/\r/g, '')
    .trimEnd();
}

function renderRoundedBox(doc, text, { bg, border, textColor, fontSize = 8.5, font = 'Courier' }) {
  const contentWidth = doc.page.width - 80;
  const padding = 7;
  const innerWidth = contentWidth - (padding * 2);

  // Split very long outputs or code blocks into page-friendly line chunks
  const lines = text.split('\n');
  const maxLinesPerBox = 35;
  const chunks = [];

  for (let i = 0; i < lines.length; i += maxLinesPerBox) {
    chunks.push(lines.slice(i, i + maxLinesPerBox).join('\n'));
  }

  chunks.forEach((chunk) => {
    doc.font(font).fontSize(fontSize);
    const textHeight = doc.heightOfString(chunk, { width: innerWidth, lineGap: 1.5 });
    const boxHeight = textHeight + (padding * 2);

    // If box does not fit on page, move to next page
    if (doc.y + boxHeight > doc.page.height - 40) {
      doc.addPage();
    }

    const startY = doc.y;
    const startX = 40;

    // Draw rounded background box
    doc.save();
    doc.roundedRect(startX, startY, contentWidth, boxHeight, 4)
      .lineWidth(0.7)
      .strokeColor(border)
      .fillColor(bg)
      .fillAndStroke();
    doc.restore();

    // Render code or output text inside the box
    doc.font(font).fontSize(fontSize).fillColor(textColor)
      .text(chunk, startX + padding, startY + padding, {
        width: innerWidth,
        lineGap: 1.5,
      });

    doc.y = startY + boxHeight + 6;
  });
}

function renderCodeCell(doc, cell, codeText, contentWidth) {
  const executionNum = cell.execution_count != null ? cell.execution_count : ' ';

  // Check if room for badge + top of code
  if (doc.y > doc.page.height - 70) {
    doc.addPage();
  }

  // Execution badge
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#2563EB')
    .text(`In [${executionNum}]:`);
  doc.moveDown(0.2);

  // Code block with distinct rounded box (#F1F5F9)
  renderRoundedBox(doc, codeText.trimEnd(), {
    bg: '#F1F5F9',
    border: '#CBD5E1',
    textColor: '#0F172A',
    fontSize: 8.5,
    font: 'Courier',
  });

  // Render outputs if any
  if (Array.isArray(cell.outputs) && cell.outputs.length > 0) {
    cell.outputs.forEach((output) => {
      // 1. Text outputs
      let outputText = '';
      if (output.text) {
        outputText = Array.isArray(output.text) ? output.text.join('') : output.text;
      } else if (output.data && output.data['text/plain']) {
        const val = output.data['text/plain'];
        outputText = Array.isArray(val) ? val.join('') : val;
      }

      const cleaned = cleanOutputText(outputText);
      if (cleaned.trim()) {
        // Output block with lighter grey rounded box (#F8FAFC)
        renderRoundedBox(doc, cleaned, {
          bg: '#F8FAFC',
          border: '#E2E8F0',
          textColor: '#334155',
          fontSize: 8,
          font: 'Courier',
        });
      }

      // 2. Image outputs (matplotlib/seaborn charts)
      const imgData = output.data?.['image/png'] || output.data?.['image/jpeg'];
      if (imgData) {
        try {
          const imgBuffer = Buffer.from(imgData.replace(/\s/g, ''), 'base64');
          if (doc.y + 200 > doc.page.height - 40) {
            doc.addPage();
          }
          doc.image(imgBuffer, {
            fit: [contentWidth - 40, 260],
            align: 'center',
          });
          doc.moveDown(0.5);
        } catch (imgErr) {
          console.warn('Could not embed notebook output image:', imgErr.message);
        }
      }
    });
  }
}

function renderPythonScript(doc, scriptText) {
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#2563EB').text('Python Script');
  doc.moveDown(0.3);

  const lines = scriptText.split(/\r?\n/);
  const formattedLines = lines.map((line, idx) => {
    const lineNum = String(idx + 1).padStart(4, ' ');
    return `${lineNum} | ${line}`;
  }).join('\n');

  renderRoundedBox(doc, formattedLines, {
    bg: '#F1F5F9',
    border: '#CBD5E1',
    textColor: '#0F172A',
    fontSize: 8.5,
    font: 'Courier',
  });
}

module.exports = {
  resolveNotebookUrl,
  fetchNotebookContent,
  convertNotebookToPdfBuffer,
};
