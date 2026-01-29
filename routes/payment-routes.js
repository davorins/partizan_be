const express = require('express');
const router = express.Router();
const PaymentServiceFactory = require('../services/PaymentServiceFactory');
const { authenticate } = require('../utils/auth');
const { body, validationResult } = require('express-validator');

// Process payment (NO organizationId!)
router.post(
  '/process',
  authenticate,
  [
    // REMOVE organizationId validation
    body('sourceId').notEmpty().withMessage('Payment source is required'),
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('Valid amount is required'),
    body('parentId').isMongoId().withMessage('Parent ID is required'),
    body('buyerEmailAddress').isEmail().withMessage('Valid email is required'),
    body('paymentSystem')
      .optional()
      .isIn(['square', 'clover', 'stripe', 'paypal']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const {
        sourceId,
        amount,
        parentId,
        buyerEmailAddress,
        paymentSystem,
        playerIds = [],
        season,
        year,
        tryoutId,
        cardDetails,
        description,
        metadata = {},
      } = req.body;

      // Convert amount to cents if in dollars
      const amountInCents = Math.round(parseFloat(amount) * 100);

      // Get payment service (NO organizationId!)
      const paymentService =
        await PaymentServiceFactory.getService(paymentSystem);

      // Process payment
      const processedPayment = await paymentService.processPayment({
        sourceId,
        amount: amountInCents,
        email: buyerEmailAddress,
        referenceId: `parent:${parentId}`,
        note: description || 'Payment for basketball camp',
      });

      // Return response
      res.json({
        success: true,
        payment: {
          id: processedPayment.id,
          status: processedPayment.status,
          amount: amount,
          paymentSystem: paymentService.type,
          receiptUrl:
            processedPayment.receipt_url || processedPayment.receiptUrl,
          cardDetails: processedPayment.card_details || processedPayment.card,
        },
      });
    } catch (error) {
      console.error('Payment processing error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details:
          process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  },
);

// Process refund (NO organizationId!)
router.post(
  '/refund',
  authenticate,
  [
    body('paymentId').notEmpty().withMessage('Payment ID is required'),
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('Valid refund amount is required'),
    body('parentId').optional().isMongoId(),
    body('paymentSystem')
      .optional()
      .isIn(['square', 'clover', 'stripe', 'paypal']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const {
        paymentId,
        amount,
        parentId,
        paymentSystem,
        reason = 'Customer request',
      } = req.body;

      // Get payment service (NO organizationId!)
      const paymentService =
        await PaymentServiceFactory.getService(paymentSystem);

      // Convert amount to cents
      const amountInCents = Math.round(parseFloat(amount) * 100);

      // Process refund
      const refundResult = await paymentService.refundPayment(
        paymentId,
        amountInCents,
        reason,
      );

      res.json({
        success: true,
        refund: {
          id: refundResult.id,
          amount: amount,
          status: refundResult.status,
          reason,
          paymentId,
        },
      });
    } catch (error) {
      console.error('Refund processing error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  },
);

// Get payment details (NO organizationId!)
router.get('/details/:paymentId', authenticate, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { paymentSystem } = req.query;

    // Get payment service
    const paymentService =
      await PaymentServiceFactory.getService(paymentSystem);

    // Get payment details
    const paymentDetails = await paymentService.getPaymentDetails(paymentId);

    res.json({
      success: true,
      data: paymentDetails,
    });
  } catch (error) {
    console.error('Error getting payment details:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get current payment system
router.get('/system', authenticate, async (req, res) => {
  try {
    const paymentService = await PaymentServiceFactory.getService();

    res.json({
      success: true,
      paymentSystem: paymentService.type,
      isActive: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Switch payment system (for testing/admin)
router.post('/switch', authenticate, async (req, res) => {
  try {
    const { paymentSystem } = req.body;

    if (!paymentSystem || !['square', 'clover'].includes(paymentSystem)) {
      return res.status(400).json({
        success: false,
        error: 'Valid payment system required (square or clover)',
      });
    }

    const paymentService =
      await PaymentServiceFactory.switchPaymentSystem(paymentSystem);

    res.json({
      success: true,
      message: `Switched to ${paymentSystem} payment system`,
      paymentSystem: paymentService.type,
    });
  } catch (error) {
    console.error('Error switching payment system:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
