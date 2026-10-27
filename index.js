const express = require('express');
const cors = require('cors');
const scanRoutes = require('./routes/scan');
const compressRoutes = require('./routes/compress');
const path = require('path');

const app = express();
const fsSync = require('fs');

// Ensure uploads and processed folders exist
['uploads', 'processed'].forEach(dir => {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir);
    console.log(`Created missing folder: ${dir}`);
  }
});
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/processed', express.static(path.join(__dirname, 'processed')));

// Routes
app.use('/scan', scanRoutes);
app.use('/compress-image', compressRoutes);
const { compressPdf } = require('./controllers/scanController');
const multer = require('multer');
const upload = multer({ dest: path.join(__dirname, 'uploads/') });
app.post('/compress-pdf', upload.single('file'), compressPdf);
const mergeRoutes = require('./routes/merge');
app.use('/merge', mergeRoutes);
const convertRoutes = require('./routes/convert');
app.use('/convert', convertRoutes);

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Centralized error handler to catch unexpected route errors and Multer exceptions cleanly
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error("Express global error:", err);
  const status = err.status || err.statusCode || (err.name === "MulterError" ? 400 : 500);
  return res.status(status).json({
    error: err.message || "An unexpected server error occurred.",
  });
});

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`ScanX backend running on http://localhost:${PORT}`);

    // Periodic cleanup for temporary files older than 30 minutes
    const fs = require('fs').promises;
    const path = require('path');
    const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
    const FILE_AGE_LIMIT = 30 * 60 * 1000; // 30 minutes

    const cleanupOldFiles = async (dir) => {
      try {
        const files = await fs.readdir(dir);
        const now = Date.now();
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stats = await fs.stat(filePath);
          if (now - stats.mtime.getTime() > FILE_AGE_LIMIT) {
            await fs.unlink(filePath);
            console.log(`Deleted old file: ${filePath}`);
          }
        }
      } catch (error) {
        console.error(`Cleanup error in ${dir}:`, error);
      }
    };

    setInterval(async () => {
      await cleanupOldFiles('uploads');
      await cleanupOldFiles('processed');
    }, CLEANUP_INTERVAL);

    console.log('File cleanup scheduler started.');
  });
}

module.exports = app;

