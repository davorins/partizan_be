// routes/spotlightRoutes.js
const express = require('express');
const router = express.Router();
const Spotlight = require('../models/Spotlight');
const multer = require('multer');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
const path = require('path');

// Auth middleware
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ✅ R2 client — reuses the same config as your existing r2.js util
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// ✅ Upload a buffer to R2, return the public URL
const uploadToR2 = async (buffer, originalName, mimetype) => {
  const ext = path.extname(originalName) || '.jpg';
  const key = `spotlight/spotlight_${Date.now()}_${randomUUID()}${ext}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    }),
  );

  return { url: `${R2_PUBLIC_URL}/${key}`, key };
};

// ✅ Delete a file from R2 by its public URL
const deleteFromR2 = async (imageUrl) => {
  try {
    // Extract the key from the full public URL
    // e.g. https://pub-xxx.r2.dev/spotlight/spotlight_123.jpg → spotlight/spotlight_123.jpg
    const key = imageUrl.replace(`${R2_PUBLIC_URL}/`, '');
    if (!key || key === imageUrl) {
      console.warn('Could not extract R2 key from URL:', imageUrl);
      return;
    }

    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      }),
    );

    console.log('Deleted from R2:', key);
  } catch (err) {
    console.error('Error deleting from R2:', err);
  }
};

// ✅ Multer uses memory storage — we handle the upload to R2 ourselves
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
});

// Create new spotlight (admin only)
router.post(
  '/',
  requireAuth,
  requireAdmin,
  upload.array('images', 6),
  async (req, res) => {
    try {
      const {
        title,
        description,
        category,
        playerNames,
        badges,
        date,
        featured,
      } = req.body;

      console.log('Request body:', req.body);
      console.log('Uploaded files:', req.files?.length);

      // ✅ Upload each file buffer to R2
      const imageUrls = await Promise.all(
        (req.files || []).map((file) =>
          uploadToR2(file.buffer, file.originalname, file.mimetype).then(
            (r) => r.url,
          ),
        ),
      );

      console.log('R2 image URLs:', imageUrls);

      const doc = new Spotlight({
        title,
        description,
        category,
        playerNames: playerNames ? JSON.parse(playerNames) : [],
        badges: badges ? JSON.parse(badges) : [],
        images: imageUrls,
        date: date ? new Date(date) : undefined,
        featured: featured === 'true' || featured === true,
        createdBy: req.user._id,
      });

      await doc.save();

      console.log('Spotlight item created successfully:', doc._id);
      res.status(201).json(doc);
    } catch (err) {
      console.error('Error creating spotlight:', err);
      res
        .status(500)
        .json({ message: 'Error creating spotlight', error: err.message });
    }
  },
);

// Get list (public)
router.get('/', async (req, res) => {
  try {
    const q = {};
    if (req.query.featured) q.featured = req.query.featured === 'true';
    if (req.query.category) q.category = req.query.category;
    const items = await Spotlight.find(q).sort({ featured: -1, date: -1 });
    res.json(items);
  } catch (err) {
    console.error('Error fetching spotlight items:', err);
    res.status(500).json({ message: 'Error fetching items' });
  }
});

// Get single
router.get('/:id', async (req, res) => {
  try {
    const item = await Spotlight.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    console.error('Error fetching spotlight item:', err);
    res.status(500).json({ message: 'Error fetching item' });
  }
});

// Update (admin)
router.put(
  '/:id',
  requireAuth,
  requireAdmin,
  upload.array('images', 6),
  async (req, res) => {
    try {
      const item = await Spotlight.findById(req.params.id);
      if (!item)
        return res.status(404).json({ message: 'Spotlight item not found' });

      const {
        title,
        description,
        category,
        playerNames,
        badges,
        date,
        featured,
        removeImages,
      } = req.body;

      console.log('Update request - removeImages:', removeImages);
      console.log('Update request - new files:', req.files?.length);

      if (title !== undefined) item.title = title;
      if (description !== undefined) item.description = description;
      if (category !== undefined) item.category = category;
      item.playerNames = playerNames
        ? JSON.parse(playerNames)
        : item.playerNames;
      item.badges = badges ? JSON.parse(badges) : item.badges;
      if (date) item.date = new Date(date);
      item.featured = featured === 'true' || featured === true;

      // ✅ Remove images from R2 and from the document
      if (removeImages) {
        const toRemove = JSON.parse(removeImages);
        console.log('Images to remove:', toRemove);

        await Promise.all(toRemove.map(deleteFromR2));
        item.images = item.images.filter((img) => !toRemove.includes(img));
      }

      // ✅ Upload new images to R2
      if (req.files && req.files.length) {
        const newUrls = await Promise.all(
          req.files.map((file) =>
            uploadToR2(file.buffer, file.originalname, file.mimetype).then(
              (r) => r.url,
            ),
          ),
        );
        console.log('Adding new images:', newUrls);
        item.images = [...item.images, ...newUrls];
      }

      await item.save();
      res.json(item);
    } catch (err) {
      console.error('Error updating spotlight item:', err);
      res
        .status(500)
        .json({ message: 'Error updating item', error: err.message });
    }
  },
);

// Delete (admin)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const item = await Spotlight.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });

    console.log('Deleting spotlight item:', item._id);
    console.log('Images to delete from R2:', item.images);

    // ✅ Delete all images from R2
    if (item.images && item.images.length > 0) {
      await Promise.all(item.images.map(deleteFromR2));
    }

    await Spotlight.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('Error deleting spotlight item:', err);
    res.status(500).json({ message: 'Error deleting' });
  }
});

module.exports = router;
