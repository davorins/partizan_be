const clover = require('clover-sdk');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Parent = require('../models/Parent');
const Player = require('../models/Player');
const Registration = require('../models/Registration');
require('dotenv').config();
const { sendEmail } = require('../utils/email');

// Initialize Clover Client
const cloverClient = new clover.ApiClient();
const merchantId = process.env.CLOVER_MERCHANT_ID;
const accessToken = process.env.CLOVER_ACCESS_TOKEN;

// Configure authentication
cloverClient.basePath =
  process.env.NODE_ENV === 'production'
    ? 'https://api.clover.com/v3'
    : 'https://sandbox.dev.clover.com/v3';
cloverClient.authentications['oauth'].accessToken = accessToken;

const merchantApi = new clover.MerchantApi(cloverClient);
const ordersApi = new clover.OrdersApi(cloverClient);
const paymentsApi = new clover.PaymentsApi(cloverClient);
const refundsApi = new clover.RefundsApi(cloverClient);

async function submitPayment(
  token,
  amount,
  {
    parentId,
    playerIds = [],
    season,
    year,
    tryoutId,
    cardDetails,
    buyerEmailAddress,
    description = 'Form submission payment',
  },
) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate minimum requirements
    if (!token) throw new Error('Payment token is required');
    if (!amount || isNaN(amount)) throw new Error('Valid amount is required');
    if (!parentId) throw new Error('Parent ID is required');
    if (!buyerEmailAddress) throw new Error('Email is required for receipt');
    if (!merchantId) throw new Error('Clover merchant ID not configured');

    console.log('💳 Starting Clover payment processing:', {
      amount: amount / 100,
      playerCount: playerIds.length,
      season,
      year,
      merchantId,
    });

    // Create an order first
    const order = {
      total: parseInt(amount),
      currency: 'USD',
      note: description,
      email: buyerEmailAddress,
      manualTransaction: false,
    };

    console.log('📦 Creating Clover order:', order);

    let cloverOrder;
    try {
      const orderResponse = await ordersApi.createOrder(merchantId, order);
      cloverOrder = orderResponse.data;
      console.log('✅ Clover order created:', {
        orderId: cloverOrder?.id,
        total: cloverOrder?.total,
      });
    } catch (cloverError) {
      console.error('❌ Clover order creation error:', {
        message: cloverError.message,
        response: cloverError.response?.data,
      });
      throw new Error(`Order creation failed: ${cloverError.message}`);
    }

    // Process payment
    const payment = {
      orderId: cloverOrder.id,
      amount: parseInt(amount),
      currency: 'USD',
      source: token,
      offline: false,
      tipAmount: 0,
      taxAmount: 0,
      externalPaymentId: `parent:${parentId}`,
      note: description,
    };

    console.log('📦 Processing Clover payment:', {
      orderId: payment.orderId,
      amount: payment.amount,
    });

    let cloverPayment;
    try {
      const paymentResponse = await paymentsApi.createPayment(
        merchantId,
        payment,
      );
      cloverPayment = paymentResponse.data;

      console.log('✅ Clover payment response:', {
        paymentId: cloverPayment?.id,
        amount: cloverPayment?.amount,
        status: cloverPayment?.status,
      });
    } catch (paymentError) {
      console.error('❌ Clover payment error:', {
        message: paymentError.message,
        response: paymentError.response?.data,
      });

      // Handle specific Clover errors
      if (paymentError.response?.data) {
        const errorData = paymentError.response.data;
        let errorMessage = 'Payment failed';

        if (errorData.message?.includes('card declined')) {
          errorMessage = 'Card was declined. Please use a different card.';
        } else if (errorData.message?.includes('insufficient funds')) {
          errorMessage =
            'Insufficient funds. Please use a different payment method.';
        } else if (errorData.message?.includes('invalid card')) {
          errorMessage =
            'Invalid card information. Please check your card details.';
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }

        throw new Error(`Clover payment failed: ${errorMessage}`);
      }
      throw paymentError;
    }

    if (!cloverPayment) {
      throw new Error('No payment response from Clover');
    }

    // Clover payment statuses: 'PENDING', 'AUTHORIZED', 'PAID', 'REFUNDED', 'VOIDED', 'FAILED'
    if (!['PAID', 'AUTHORIZED'].includes(cloverPayment.status)) {
      throw new Error(`Payment failed with status: ${cloverPayment.status}`);
    }

    // Store payment details
    const paymentRecord = new Payment({
      playerIds,
      parentId,
      paymentId: cloverPayment.id,
      orderId: cloverOrder.id,
      amount: amount / 100, // Convert cents to dollars
      status: cloverPayment.status.toLowerCase(),
      cardLastFour: cardDetails?.last_4 || cloverPayment.card?.last4 || '1111',
      cardBrand:
        cardDetails?.card_brand || cloverPayment.card?.type || 'UNKNOWN',
      cardExpMonth: cardDetails?.exp_month || '00',
      cardExpYear: cardDetails?.exp_year || '00',
      merchantId: merchantId,
      buyerEmail: buyerEmailAddress,
      players: playerIds.map((id) => ({
        playerId: id,
        season,
        year,
        tryoutId,
      })),
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
        // Update player documents
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
        // Update registrations
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
      await sendEmail({
        to: buyerEmailAddress,
        subject: 'Payment Confirmation - Basketball Camp',
        html: `
          <h2>Payment Successful</h2>
          <p>Amount: $${(amount / 100).toFixed(2)}</p>
          ${playerIds.length > 0 ? `<p>Players: ${playerIds.length}</p>` : ''}
          <p>Payment ID: ${cloverPayment.id}</p>
          <p>Order ID: ${cloverOrder.id}</p>
          <p>Date: ${new Date().toLocaleDateString()}</p>
          <p>Status: ${cloverPayment.status}</p>
        `,
      });
    } catch (emailError) {
      console.warn('⚠️ Email sending failed:', emailError.message);
    }

    await session.commitTransaction();

    console.log('✅ Payment completed successfully:', {
      paymentId: paymentRecord._id,
      cloverId: cloverPayment.id,
      amount: amount / 100,
      playerCount: playerIds.length,
    });

    return {
      success: true,
      payment: {
        id: paymentRecord._id,
        cloverId: cloverPayment.id,
        orderId: cloverOrder.id,
        amount: amount / 100,
        status: cloverPayment.status,
        playersUpdated: playerIds.length,
        parentUpdated: true,
      },
    };
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Payment processing failed:', {
      error: error.message,
      stack: error.stack,
      parentId,
      playerIds,
      amount,
    });
    throw error;
  } finally {
    session.endSession();
  }
}

// REFUND FUNCTIONALITY
async function processRefund(
  paymentId,
  amount,
  { reason = 'Customer request', parentId, refundAll = false },
) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!paymentId) throw new Error('Payment ID is required');
    if (!amount || amount <= 0)
      throw new Error('Valid refund amount is required');
    if (!merchantId) throw new Error('Clover merchant ID not configured');

    console.log('processRefund called with paymentId:', paymentId);

    // Find payment record
    const paymentRecord = await Payment.findOne({
      paymentId: paymentId,
    }).session(session);

    if (!paymentRecord) {
      throw new Error(`Payment record not found with Clover ID: ${paymentId}`);
    }

    console.log('Found payment record in processRefund:', {
      mongoId: paymentRecord._id,
      cloverId: paymentRecord.paymentId,
      amount: paymentRecord.amount,
      refundedAmount: paymentRecord.refundedAmount || 0,
    });

    // Check if payment is already refunded
    if (paymentRecord.refundStatus === 'refunded') {
      throw new Error('Payment has already been fully refunded');
    }

    if (paymentRecord.refundStatus === 'partially_refunded' && refundAll) {
      throw new Error('Payment has already been partially refunded');
    }

    // Calculate refund amount
    const amountInCents = Math.round(amount * 100);
    const originalAmountInCents = Math.round(paymentRecord.amount * 100);

    if (amountInCents > originalAmountInCents) {
      throw new Error('Refund amount cannot exceed original payment amount');
    }

    const previouslyRefunded = paymentRecord.refundedAmount || 0;
    const availableForRefund = paymentRecord.amount - previouslyRefunded;

    if (amount > availableForRefund) {
      throw new Error(
        `Maximum refund amount available: $${availableForRefund.toFixed(2)}`,
      );
    }

    // Process refund with Clover
    const refundRequest = {
      paymentId: paymentRecord.paymentId,
      amount: amountInCents,
      reason: reason,
    };

    let cloverRefund;
    try {
      const refundResponse = await refundsApi.createRefund(
        merchantId,
        refundRequest,
      );
      cloverRefund = refundResponse.data;

      if (!cloverRefund) {
        throw new Error('Clover refund response invalid');
      }
    } catch (cloverError) {
      console.error('Clover refund error:', {
        message: cloverError.message,
        response: cloverError.response?.data,
      });

      if (cloverError.response?.data?.message?.includes('already refunded')) {
        throw new Error('This payment has already been refunded');
      }
      throw new Error(`Refund failed: ${cloverError.message}`);
    }

    // Update payment record with refund details
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
      refundId: cloverRefund.id,
      amount: amount,
      reason: reason,
      status: cloverRefund.status,
      processedAt: new Date(),
      cloverRefundId: cloverRefund.id,
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
                  refundId: cloverRefund.id,
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
      await sendEmail({
        to: paymentRecord.buyerEmail,
        subject: 'Refund Processed - Basketball Camp',
        html: `
          <h2>Refund Processed</h2>
          <p>Original Payment Amount: $${paymentRecord.amount.toFixed(2)}</p>
          <p>Refund Amount: $${amount.toFixed(2)}</p>
          <p>Refund Reason: ${reason}</p>
          <p>Refund ID: ${cloverRefund.id}</p>
          <p>Date: ${new Date().toLocaleDateString()}</p>
          <p><strong>Note:</strong> Refunds typically take 5-10 business days to appear on your original payment method.</p>
        `,
      });
    }

    await session.commitTransaction();

    return {
      success: true,
      refund: {
        id: cloverRefund.id,
        amount: amount,
        status: cloverRefund.status,
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

// Get payment details for refund validation
async function getPaymentDetails(paymentId) {
  try {
    const paymentRecord = await Payment.findOne({
      $or: [{ paymentId: paymentId }, { _id: paymentId }],
    });

    if (!paymentRecord) {
      throw new Error('Payment record not found');
    }

    return {
      paymentId: paymentRecord.paymentId,
      orderId: paymentRecord.orderId,
      amount: paymentRecord.amount,
      refundedAmount: paymentRecord.refundedAmount || 0,
      availableForRefund:
        paymentRecord.amount - (paymentRecord.refundedAmount || 0),
      refundStatus: paymentRecord.refundStatus,
      buyerEmail: paymentRecord.buyerEmail,
      cardLastFour: paymentRecord.cardLastFour,
      createdAt: paymentRecord.createdAt,
    };
  } catch (error) {
    console.error('Error getting payment details:', error);
    throw error;
  }
}

module.exports = {
  submitPayment,
  processRefund,
  getPaymentDetails,
  cloverClient,
  merchantId,
};
