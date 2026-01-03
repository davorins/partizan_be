// utils/fileUpload.js
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Make sure Cloudinary is configured
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // Ensure HTTPS
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'attachments',
    allowed_formats: [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'txt',
      'zip',
      'rar',
    ],
    resource_type: 'auto', // This is important for non-images
    public_id: (req, file) => {
      // Generate unique filename
      return `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '')}`;
    },
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Keep your file filter logic
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
  },
});

// utils/fileUpload.js - Update getFileInfo function
const getFileInfo = (file) => {
  console.log('Cloudinary file info:', {
    originalname: file.originalname,
    path: file.path,
    size: file.size,
    mimetype: file.mimetype,
    filename: file.filename,
    secure_url: file.secure_url,
  });

  // Use secure_url if available, otherwise use path
  let cloudinaryUrl = file.secure_url || file.path;

  // For ALL files, ensure we have the correct delivery URL
  // Cloudinary's raw upload URLs should be used for non-image files
  if (file.mimetype && !file.mimetype.startsWith('image/')) {
    // For non-image files, get the raw URL
    if (cloudinaryUrl.includes('/image/upload/')) {
      cloudinaryUrl = cloudinaryUrl.replace('/image/upload/', '/raw/upload/');
    }
  } else {
    // For images, ensure we have the correct URL
    if (!cloudinaryUrl.includes('/image/upload/')) {
      // Construct the proper image URL
      const publicId = file.public_id || file.filename;
      cloudinaryUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${publicId}`;
    }
  }

  return {
    filename: file.originalname,
    url: cloudinaryUrl,
    size: file.size,
    mimeType: file.mimetype,
    uploadedAt: new Date(),
    publicId: file.filename,
    cloudinaryPublicId: file.public_id || file.filename,
  };
};

module.exports = {
  upload,
  getFileInfo,
};
