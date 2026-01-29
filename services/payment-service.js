const mongoose = require('mongoose');
const PaymentConfiguration = require('../models/PaymentConfiguration');
const PaymentServiceFactory = require('./PaymentServiceFactory');
const Payment = require('../models/Payment');
const Parent = require('../models/Parent');
const Player = require('../models/Player');
const Registration = require('../models/Registration');
const { sendEmail } = require('../utils/email');

class UnifiedPaymentService {
  constructor() {
    this.paymentFactory = PaymentServiceFactory;
  }

  async submitPayment(
    organizationId,
    paymentData,
    {
      parentId,
      playerIds = [],
      season,
      year,
      tryoutId,
      cardDetails,
      buyerEmailAddress,
      description = 'Form submission payment',
      metadata = {},
    },
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Validate inputs
      if (!organizationId) throw new Error('Organization ID is required');
      if (!paymentData.sourceId) throw new Error('Payment source is required');
      if (!paymentData.amount || isNaN(paymentData.amount))
        throw new Error('Valid amount is required');
      if (!parentId) throw new Error('Parent ID is required');
      if (!buyerEmailAddress) throw new Error('Email is required for receipt');

      console.log('💳 Starting unified payment processing:', {
        organizationId,
        amount: paymentData.amount / 100,
        playerCount: playerIds.length,
        parentId,
      });

      // Get payment service based on organization configuration
      const paymentService = await this.paymentFactory.getService(
        organizationId,
        paymentData.paymentSystem, // Optional: specify payment system
      );

      // Process payment using the appropriate service
      let processedPayment;
      let orderId;

      if (paymentService.type === 'clover') {
        // Clover requires order creation first
        const order = {
          total: parseInt(paymentData.amount),
          currency: paymentService.config.settings?.currency || 'USD',
          note: description,
          email: buyerEmailAddress,
          manualTransaction: false,
        };

        // For Clover, we need to create an order first
        const cloverOrdersApi = new (require('clover-sdk').OrdersApi)(
          paymentService.client,
        );
        const orderResponse = await cloverOrdersApi.createOrder(
          paymentService.config.merchantId,
          order,
        );
        orderId = orderResponse.data.id;

        // Prepare payment data for Clover
        const cloverPaymentData = {
          ...paymentData,
          orderId,
          referenceId: `parent:${parentId}`,
        };

        processedPayment =
          await paymentService.processPayment(cloverPaymentData);
      } else {
        // Square, Stripe, PayPal - standard processing
        processedPayment = await paymentService.processPayment({
          ...paymentData,
          referenceId: `parent:${parentId}`,
          note: description,
          email: buyerEmailAddress,
        });
      }

      console.log('✅ Payment processed:', {
        paymentSystem: paymentService.type,
        paymentId: processedPayment.id,
        status: processedPayment.status,
      });

      // Store payment details in your database
      const paymentRecord = new Payment({
        playerIds,
        parentId,
        paymentId: processedPayment.id,
        orderId,
        amount: paymentData.amount / 100,
        status: processedPayment.status.toLowerCase(),
        paymentSystem: paymentService.type,
        organizationId,
        configurationId: paymentService.configurationId,
        cardLastFour:
          cardDetails?.last_4 || processedPayment.card?.last4 || '1111',
        cardBrand:
          cardDetails?.card_brand || processedPayment.card?.type || 'UNKNOWN',
        cardExpMonth: cardDetails?.exp_month || '00',
        cardExpYear: cardDetails?.exp_year || '00',
        merchantId:
          paymentService.type === 'clover'
            ? paymentService.config.merchantId
            : undefined,
        locationId:
          paymentService.type === 'square'
            ? paymentService.config.locationId
            : undefined,
        buyerEmail: buyerEmailAddress,
        players: playerIds.map((id) => ({
          playerId: id,
          season,
          year,
          tryoutId,
        })),
        metadata: {
          ...metadata,
          paymentSystem: paymentService.type,
        },
      });

      await paymentRecord.save({ session });

      // Update parent payment status
      await Parent.updateOne(
        { _id: parentId },
        {
          $set: {
            paymentComplete: true,
            lastPaymentDate: new Date(),
          },
          $push: { payments: paymentRecord._id },
        },
        { session },
      );

      // Update players if specified
      if (playerIds.length > 0) {
        await Promise.all([
          Player.updateMany(
            { _id: { $in: playerIds } },
            {
              $set: {
                paymentComplete: true,
                paymentStatus: 'paid',
              },
              $push: {
                seasons: {
                  season,
                  year,
                  tryoutId,
                  paymentStatus: 'paid',
                  paymentDate: new Date(),
                  paymentId: paymentRecord._id,
                },
              },
            },
            { session },
          ),
          Registration.updateMany(
            {
              player: { $in: playerIds },
              season,
              year,
              tryoutId,
            },
            {
              $set: {
                paymentStatus: 'paid',
                paymentComplete: true,
                paymentDate: new Date(),
                paymentId: paymentRecord._id,
              },
            },
            { session },
          ),
        ]);
      }

      // Send receipt email
      try {
        const receiptDetails = {
          paymentSystem: paymentService.type,
          paymentId: processedPayment.id,
          orderId,
          amount: paymentData.amount / 100,
          currency: paymentService.config.settings?.currency || 'USD',
          receiptUrl: processedPayment.receiptUrl,
        };

        await this.sendReceiptEmail(buyerEmailAddress, receiptDetails, {
          playerCount: playerIds.length,
          description,
        });
      } catch (emailError) {
        console.warn('⚠️ Email sending failed:', emailError.message);
      }

      await session.commitTransaction();

      console.log('✅ Payment completed successfully:', {
        paymentId: paymentRecord._id,
        externalId: processedPayment.id,
        amount: paymentData.amount / 100,
        playerCount: playerIds.length,
        paymentSystem: paymentService.type,
      });

      return {
        success: true,
        payment: {
          id: paymentRecord._id,
          externalId: processedPayment.id,
          orderId,
          amount: paymentData.amount / 100,
          status: processedPayment.status,
          paymentSystem: paymentService.type,
          playersUpdated: playerIds.length,
          parentUpdated: true,
          receiptUrl: processedPayment.receiptUrl,
        },
      };
    } catch (error) {
      await session.abortTransaction();
      console.error('❌ Payment processing failed:', {
        error: error.message,
        stack: error.stack,
        organizationId,
        parentId,
        amount: paymentData.amount,
      });
      throw error;
    } finally {
      session.endSession();
    }
  }

  async processRefund(
    organizationId,
    paymentId,
    amount,
    {
      reason = 'Customer request',
      parentId,
      refundAll = false,
      paymentSystem,
    } = {},
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (!paymentId) throw new Error('Payment ID is required');
      if (!amount || amount <= 0)
        throw new Error('Valid refund amount is required');

      console.log('🔄 Processing refund:', {
        organizationId,
        paymentId,
        amount,
        paymentSystem,
      });

      // Find payment record
      const paymentRecord = await Payment.findOne({
        paymentId: paymentId,
      }).session(session);

      if (!paymentRecord) {
        throw new Error(`Payment record not found: ${paymentId}`);
      }

      // Use specified payment system or get from record
      const targetPaymentSystem = paymentSystem || paymentRecord.paymentSystem;

      // Get payment service
      const paymentService = await this.paymentFactory.getService(
        organizationId,
        targetPaymentSystem,
      );

      // Calculate refund amount in cents
      const amountInCents = Math.round(amount * 100);

      // Process refund with payment service
      const refundResult = await paymentService.refundPayment(
        paymentId,
        amountInCents,
        reason,
      );

      // Update payment record with refund details
      const previouslyRefunded = paymentRecord.refundedAmount || 0;
      const newRefundedAmount = previouslyRefunded + amount;
      const isFullRefund = newRefundedAmount >= paymentRecord.amount;
      const isPartialRefund =
        newRefundedAmount > 0 && newRefundedAmount < paymentRecord.amount;

      paymentRecord.refundedAmount = newRefundedAmount;
      paymentRecord.refundStatus = isFullRefund
        ? 'refunded'
        : isPartialRefund
          ? 'partially_refunded'
          : paymentRecord.refundStatus;
      paymentRecord.refunds = paymentRecord.refunds || [];
      paymentRecord.refunds.push({
        refundId: refundResult.id,
        amount: amount,
        reason: reason,
        status: refundResult.status,
        processedAt: new Date(),
        externalRefundId: refundResult.id,
      });

      await paymentRecord.save({ session });

      // Update parent and player payment status if this is a full refund
      if (isFullRefund && parentId) {
        await Parent.updateOne(
          { _id: parentId },
          {
            $set: {
              paymentComplete: false,
            },
          },
          { session },
        );

        if (paymentRecord.playerIds && paymentRecord.playerIds.length > 0) {
          await Promise.all([
            Player.updateMany(
              { _id: { $in: paymentRecord.playerIds } },
              {
                $set: {
                  paymentComplete: false,
                  paymentStatus: 'refunded',
                },
                $push: {
                  refunds: {
                    refundId: refundResult.id,
                    amount: amount,
                    paymentId: paymentRecord._id,
                    refundDate: new Date(),
                  },
                },
              },
              { session },
            ),
            Registration.updateMany(
              {
                player: { $in: paymentRecord.playerIds },
                paymentId: paymentRecord._id,
              },
              {
                $set: {
                  paymentStatus: 'refunded',
                  paymentComplete: false,
                },
              },
              { session },
            ),
          ]);
        }
      }

      // Send refund confirmation email
      if (paymentRecord.buyerEmail) {
        await this.sendRefundEmail(paymentRecord.buyerEmail, {
          originalAmount: paymentRecord.amount,
          refundAmount: amount,
          reason,
          refundId: refundResult.id,
          paymentId: paymentRecord.paymentId,
        });
      }

      await session.commitTransaction();

      return {
        success: true,
        refund: {
          id: refundResult.id,
          amount: amount,
          status: refundResult.status,
          reason: reason,
          paymentId: paymentRecord.paymentId,
          isFullRefund,
          isPartialRefund,
        },
      };
    } catch (error) {
      await session.abortTransaction();
      console.error('Refund processing failed:', {
        error: error.message,
        stack: error.stack,
        paymentId,
        amount,
      });
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getPaymentDetails(organizationId, paymentId, paymentSystem) {
    try {
      // Try to find payment record first
      const paymentRecord = await Payment.findOne({
        $or: [{ paymentId: paymentId }, { _id: paymentId }],
      });

      if (!paymentRecord) {
        throw new Error('Payment record not found');
      }

      // Get payment service if we want live data from payment processor
      if (paymentSystem) {
        const paymentService = await this.paymentFactory.getService(
          organizationId,
          paymentSystem,
        );

        const liveDetails = await paymentService.getPaymentDetails(paymentId);

        return {
          ...paymentRecord.toObject(),
          liveDetails,
        };
      }

      return paymentRecord;
    } catch (error) {
      console.error('Error getting payment details:', error);
      throw error;
    }
  }

  async sendReceiptEmail(to, paymentDetails, options = {}) {
    const { paymentSystem, paymentId, amount, currency, receiptUrl } =
      paymentDetails;
    const { playerCount = 0, description = '' } = options;

    const subject = `Payment Confirmation - ${paymentSystem.charAt(0).toUpperCase() + paymentSystem.slice(1)}`;

    let paymentSystemInfo = '';
    switch (paymentSystem) {
      case 'square':
        paymentSystemInfo = 'Processed via Square';
        break;
      case 'clover':
        paymentSystemInfo = 'Processed via Clover';
        break;
      case 'stripe':
        paymentSystemInfo = 'Processed via Stripe';
        break;
      default:
        paymentSystemInfo = 'Payment Processed';
    }

    const html = `
      <h2>Payment Successful</h2>
      <p>${paymentSystemInfo}</p>
      <p>Amount: ${amount.toFixed(2)} ${currency}</p>
      ${description ? `<p>Description: ${description}</p>` : ''}
      ${playerCount > 0 ? `<p>Players: ${playerCount}</p>` : ''}
      <p>Payment ID: ${paymentId}</p>
      <p>Date: ${new Date().toLocaleDateString()}</p>
      ${receiptUrl ? `<p><a href="${receiptUrl}">View Receipt</a></p>` : ''}
      <hr>
      <p>Thank you for your payment!</p>
    `;

    await sendEmail({
      to,
      subject,
      html,
    });
  }

  async sendRefundEmail(to, refundDetails) {
    const { originalAmount, refundAmount, reason, refundId, paymentId } =
      refundDetails;

    const html = `
      <h2>Refund Processed</h2>
      <p>Original Payment Amount: $${originalAmount.toFixed(2)}</p>
      <p>Refund Amount: $${refundAmount.toFixed(2)}</p>
      <p>Refund Reason: ${reason}</p>
      <p>Refund ID: ${refundId}</p>
      <p>Original Payment ID: ${paymentId}</p>
      <p>Date: ${new Date().toLocaleDateString()}</p>
      <p><strong>Note:</strong> Refunds typically take 5-10 business days to appear on your original payment method.</p>
    `;

    await sendEmail({
      to,
      subject: 'Refund Processed - Basketball Camp',
      html,
    });
  }

  // Get available payment systems for an organization
  async getAvailablePaymentSystems(organizationId) {
    try {
      const configurations = await PaymentConfiguration.find({
        organizationId,
        isActive: true,
      }).select('paymentSystem');

      return configurations.map((config) => config.paymentSystem);
    } catch (error) {
      console.error('Error getting payment systems:', error);
      return [];
    }
  }

  // Switch payment system for testing or manual override
  async switchPaymentSystem(organizationId, newPaymentSystem) {
    // Clear cache for this organization
    this.paymentFactory.clearCache(organizationId);

    // Get new payment service
    const paymentService = await this.paymentFactory.getService(
      organizationId,
      newPaymentSystem,
    );

    console.log(`Switched to ${newPaymentSystem} payment system`);

    return paymentService;
  }
}

module.exports = new UnifiedPaymentService();
