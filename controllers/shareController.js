const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SHARE_DIR = path.join(__dirname, '..', 'uploads', 'share');
const MANIFEST_PATH = path.join(SHARE_DIR, 'shares.json');

// Ensure share directory exists
if (!fs.existsSync(SHARE_DIR)) {
  fs.mkdirSync(SHARE_DIR, { recursive: true });
}

// In-memory + persisted metadata map
let shareStore = new Map();

function loadManifest() {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
      shareStore = new Map(Object.entries(data));
    }
  } catch (err) {
    console.error('Error loading shares manifest:', err);
    shareStore = new Map();
  }
}

function saveManifest() {
  try {
    const obj = Object.fromEntries(shareStore);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('Error saving shares manifest:', err);
  }
}

loadManifest();

/**
 * Periodically purge expired files from shareStore
 */
function cleanupExpiredShares() {
  const now = Date.now();
  let changed = false;
  for (const [id, record] of shareStore.entries()) {
    if (record.expiresAt && now > record.expiresAt) {
      const filePath = path.join(SHARE_DIR, record.storedFilename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error(`Failed to delete expired share file ${filePath}:`, e);
        }
      }
      shareStore.delete(id);
      changed = true;
    }
  }
  if (changed) saveManifest();
}

// Run cleanup every 5 minutes (unref so it doesn't block process exit / test runners)
const cleanupTimer = setInterval(cleanupExpiredShares, 5 * 60 * 1000);
if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

/**
 * POST /share/upload
 * Handles up to 100MB file upload and returns direct share link
 */
exports.uploadFile = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Maximum limit is 100MB.' });
  }

  try {
    const shareId = crypto.randomBytes(6).toString('hex'); // 12-char secure random id
    const originalName = req.file.originalname || 'shared-file';
    const storedFilename = req.file.filename;
    const size = req.file.size;
    const mimeType = req.file.mimetype || 'application/octet-stream';

    // Expiry hours: default 24h, options: 1, 24, 168 (7 days)
    const expiryHours = Math.min(168, Math.max(1, parseInt(req.body.expiryHours, 10) || 24));
    const createdAt = Date.now();
    const expiresAt = createdAt + expiryHours * 60 * 60 * 1000;

    const record = {
      shareId,
      originalName,
      storedFilename,
      size,
      mimeType,
      createdAt,
      expiresAt,
      downloadCount: 0,
    };

    shareStore.set(shareId, record);
    saveManifest();

    return res.status(200).json({
      success: true,
      shareId,
      originalName,
      size,
      mimeType,
      expiresAt: new Date(expiresAt).toISOString(),
      downloadUrl: `/share/download/${shareId}`,
      infoUrl: `/share/info/${shareId}`,
    });
  } catch (err) {
    console.error('Share upload error:', err);
    return res.status(500).json({ error: 'Failed to create shareable link: ' + err.message });
  }
};

/**
 * GET /share/info/:shareId
 * Returns metadata without authentication
 */
exports.getFileInfo = async (req, res) => {
  const { shareId } = req.params;
  const record = shareStore.get(shareId);

  if (!record) {
    return res.status(404).json({ error: 'Share link not found or has expired.' });
  }

  if (Date.now() > record.expiresAt) {
    // Expired
    cleanupExpiredShares();
    return res.status(410).json({ error: 'This file share link has expired.' });
  }

  return res.status(200).json({
    success: true,
    shareId: record.shareId,
    originalName: record.originalName,
    size: record.size,
    mimeType: record.mimeType,
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    downloadCount: record.downloadCount,
    downloadUrl: `/share/download/${shareId}`,
  });
};

/**
 * GET /share/download/:shareId
 * Direct one-click download stream without password or OTP
 */
exports.downloadFile = async (req, res) => {
  const { shareId } = req.params;
  const record = shareStore.get(shareId);

  if (!record) {
    return res.status(404).send('Share link not found or has expired.');
  }

  if (Date.now() > record.expiresAt) {
    cleanupExpiredShares();
    return res.status(410).send('This file share link has expired.');
  }

  const filePath = path.join(SHARE_DIR, record.storedFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('The requested file is no longer available on disk.');
  }

  // Increment download count
  record.downloadCount = (record.downloadCount || 0) + 1;
  saveManifest();

  // Send direct file download stream
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(record.originalName)}"`);
  res.setHeader('Content-Type', record.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', record.size);

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
};
