const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/email-attachments';

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: async (req, file, cb) => {
    try {
      // Dynamically import uuid
      const { v4: uuidv4 } = await import('uuid');
      const uniqueSuffix = uuidv4();
      const extension = path.extname(file.originalname);
      cb(null, `${Date.now()}-${uniqueSuffix}${extension}`);
    } catch (error) {
      cb(error, null);
    }
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  // Allowed file types for email attachments
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
};

// Create multer instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

// Utility function to get file info
const getFileInfo = (file) => {
  return {
    filename: file.originalname,
    url: `/uploads/email-attachments/${file.filename}`,
    size: file.size,
    mimeType: file.mimetype,
    uploadedAt: new Date(),
  };
};

// Cleanup old files (optional - can be run as a cron job)
const cleanupOldFiles = async (days = 30) => {
  const uploadDir = 'uploads/email-attachments';
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  try {
    const files = fs.readdirSync(uploadDir);

    files.forEach((file) => {
      const filePath = path.join(uploadDir, file);
      const stats = fs.statSync(filePath);

      if (stats.mtime < cutoffDate) {
        fs.unlinkSync(filePath);
        console.log(`Deleted old file: ${file}`);
      }
    });
  } catch (error) {
    console.error('Error cleaning up files:', error);
  }
};

module.exports = {
  upload,
  getFileInfo,
  cleanupOldFiles,
};
