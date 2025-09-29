const express = require('express');
const cors = require('cors');
const scanRoutes = require('./routes/scan');
const compressRoutes = require('./routes/compress');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use('/processed', express.static('processed'));

app.use('/scan', scanRoutes);
app.use('/compress-image', compressRoutes);

app.listen(PORT, () => {
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
