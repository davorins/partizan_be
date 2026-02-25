// utils/fileUpload.js
const multer = require('multer');
const { uploadToR2, deleteFromR2, isR2Url } = require('./r2');

// Configure multer for memory storage (since we're uploading to R2 directly)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Define allowed file types
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
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
  },
});

/**
 * Get file information after upload
 * @param {Object} file - The file object from multer
 * @param {string} folder - The folder path in R2
 * @returns {Promise<Object>} File information
 */
const uploadAndGetFileInfo = async (file, folder = 'attachments') => {
  try {
    console.log('📤 Uploading file to R2:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      folder,
    });

    // Upload to R2
    const { url, key } = await uploadToR2(
      file.buffer,
      folder,
      file.originalname,
    );

    console.log('✅ File uploaded to R2:', { url, key });

    return {
      filename: file.originalname,
      url: url,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date(),
      key: key,
      isImage: file.mimetype.startsWith('image/'),
    };
  } catch (error) {
    console.error('❌ Error uploading file to R2:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
};

/**
 * Get file info from an existing R2 URL
 * @param {string} url - The R2 URL
 * @returns {Object} File information
 */
const getFileInfoFromUrl = (url) => {
  if (!url) return null;

  const isR2 = isR2Url(url);

  return {
    url: url,
    isR2Url: isR2,
    key: isR2 ? url.split('/').pop() : null,
    isImage: url.match(/\.(jpg|jpeg|png|gif|webp)$/i) !== null,
  };
};

/**
 * Delete a file from R2
 * @param {string} url - The R2 URL to delete
 * @returns {Promise<boolean>}
 */
const deleteFile = async (url) => {
  try {
    if (!url || !isR2Url(url)) {
      console.log('Not an R2 URL, skipping deletion:', url);
      return false;
    }

    await deleteFromR2(url);
    console.log('✅ File deleted from R2:', url);
    return true;
  } catch (error) {
    console.error('❌ Error deleting file from R2:', error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

/**
 * Extract file key from R2 URL
 * @param {string} url - The R2 URL
 * @returns {string|null} The file key
 */
const getFileKeyFromUrl = (url) => {
  if (!url || !isR2Url(url)) return null;

  // Extract everything after the public URL
  const PUBLIC_URL = process.env.R2_PUBLIC_URL;
  if (url.includes(PUBLIC_URL)) {
    return url.replace(`${PUBLIC_URL}/`, '');
  }
  return url;
};

module.exports = {
  upload,
  uploadAndGetFileInfo,
  getFileInfoFromUrl,
  deleteFile,
  getFileKeyFromUrl,
};
