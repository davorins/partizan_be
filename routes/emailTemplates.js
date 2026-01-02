const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const EmailTemplate = require('../models/EmailTemplate');
const { authenticate } = require('../utils/auth');
const { upload, getFileInfo } = require('../utils/fileUpload');

// 🔐 Middleware for admin-only routes
const authorizeAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  next();
};

// ✅ Create a new email template
router.post(
  '/',
  authenticate,
  authorizeAdmin,
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('subject').notEmpty().withMessage('Subject is required'),
    body('content').notEmpty().withMessage('Content is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      // If frontend sends completeContent, use it; otherwise it will be auto-generated
      const templateData = {
        ...req.body,
        createdBy: req.user.id,
        lastUpdatedBy: req.user.id,
        attachments: req.body.attachments || [],
      };

      if (templateData.completeContent) {
        delete templateData.completeContent;
      }

      const template = new EmailTemplate(templateData);
      await template.save();

      res.status(201).json({ success: true, data: template });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ✅ Get all templates
router.get('/', authenticate, async (req, res) => {
  try {
    const templates = await EmailTemplate.find({});
    res.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Get template by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res
        .status(404)
        .json({ success: false, error: 'Template not found' });
    }

    // Ensure template has completeContent
    if (!template.completeContent) {
      template.completeContent = template.getCompleteEmailHTML();
      await template.save();
    }

    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Update template
router.put(
  '/:id',
  authenticate,
  authorizeAdmin,
  [
    body('title')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Title cannot be empty'),
    body('subject')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Subject cannot be empty'),
    body('content')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Content cannot be empty'),
    body('status')
      .optional()
      .isBoolean()
      .withMessage('Status must be a boolean'),
    body('variables')
      .optional()
      .isArray()
      .withMessage('Variables must be an array'),
    body('category')
      .optional()
      .isIn(['system', 'marketing', 'transactional', 'notification', 'other'])
      .withMessage('Invalid category'),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    try {
      const template = await EmailTemplate.findById(req.params.id);
      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found',
        });
      }

      // Set lastUpdatedBy
      req.body.lastUpdatedBy = req.user.id;

      // Handle attachments - only update if provided
      if (req.body.attachments !== undefined) {
        template.attachments = req.body.attachments;
      }

      // Remove completeContent if frontend sent it - let model generate fresh one
      if (req.body.completeContent) {
        delete req.body.completeContent;
      }

      // Only update allowed fields
      const updates = Object.keys(req.body);
      updates.forEach((update) => {
        template[update] = req.body[update];
      });

      await template.save();

      // Ensure template has completeContent
      if (!template.completeContent) {
        template.completeContent = template.getCompleteEmailHTML();
        await template.save();
      }

      res.json({
        success: true,
        data: template,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
        ...(error.errors && {
          validationErrors: Object.keys(error.errors),
        }),
      });
    }
  }
);

// ✅ Delete template
router.delete('/:id', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const template = await EmailTemplate.findByIdAndDelete(req.params.id);
    if (!template) {
      return res
        .status(404)
        .json({ success: false, error: 'Template not found' });
    }

    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Generate complete HTML for a template (for testing)
router.get('/:id/generate-html', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res
        .status(404)
        .json({ success: false, error: 'Template not found' });
    }

    const completeHTML = template.getCompleteEmailHTML();

    res.json({
      success: true,
      data: {
        html: completeHTML,
        hasCompleteContent: !!template.completeContent,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Upload attachment for email template
router.post(
  '/:id/upload-attachment',
  authenticate,
  upload.single('attachment'),
  async (req, res) => {
    try {
      const template = await EmailTemplate.findById(req.params.id);

      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
        });
      }

      const fileInfo = getFileInfo(req.file);

      // Add file info to template's attachments array
      template.attachments.push(fileInfo);
      await template.save();

      res.json({
        success: true,
        data: {
          attachment: fileInfo,
          templateId: template._id,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ✅ Remove attachment from email template
router.delete(
  '/:id/attachments/:attachmentId',
  authenticate,
  async (req, res) => {
    try {
      const template = await EmailTemplate.findById(req.params.id);

      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found',
        });
      }

      // Find the attachment
      const attachmentIndex = template.attachments.findIndex(
        (att) => att._id.toString() === req.params.attachmentId
      );

      if (attachmentIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Attachment not found',
        });
      }

      // Remove the file from storage
      const attachment = template.attachments[attachmentIndex];
      const fs = require('fs');
      const filePath = attachment.url.replace('/uploads/', 'uploads/');

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Remove from array
      template.attachments.splice(attachmentIndex, 1);
      await template.save();

      res.json({
        success: true,
        data: { removed: true, attachmentId: req.params.attachmentId },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ✅ Get all attachments for a template
router.get('/:id/attachments', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found',
      });
    }

    res.json({
      success: true,
      data: template.attachments || [],
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
