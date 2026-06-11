const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios');
const { authenticate } = require('../utils/auth');
const Parent = require('../models/Parent');
const Payment = require('../models/Payment');
const PaymentConfiguration = require('../models/PaymentConfiguration');
const { sendEmail } = require('../utils/email');

// ── Helper: get active Clover ecom config ────────────────────────────────────
async function getCloverConfig() {
  const config = await PaymentConfiguration.findOne({
    isActive: true,
    paymentSystem: 'clover',
  }).select('+cloverConfig.accessToken');

  if (!config) throw new Error('No active Clover configuration found');

  const ecomBase =
    config.cloverConfig.environment === 'production'
      ? 'https://scl.clover.com'
      : 'https://scl-sandbox.dev.clover.com';

  return { config: config.cloverConfig, ecomBase };
}

// ── POST /api/subscriptions/save-card ────────────────────────────────────────
// Called after a successful payment when parent opts into auto-pay.
// Creates a Clover customer (if needed) and saves the card token.
router.post('/save-card', authenticate, async (req, res) => {
  try {
    const {
      token, // single-use token from CloverPaymentForm
      plan, // e.g. 'monthly-training'
      packageName, // e.g. '4-Session Pack'
      amountCents, // e.g. 25000
      playerIds,
      season,
      year,
      eventId,
    } = req.body;

    if (!token) {
      return res
        .status(400)
        .json({ success: false, error: 'Card token is required' });
    }
    if (!amountCents || amountCents <= 0) {
      return res
        .status(400)
        .json({ success: false, error: 'Valid amount is required' });
    }

    const parent = await Parent.findById(req.user.id);
    if (!parent) {
      return res
        .status(404)
        .json({ success: false, error: 'Parent not found' });
    }

    const { config, ecomBase } = await getCloverConfig();
    const headers = {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    };

    let cloverCustomerId = parent.cloverCustomerId;

    // Create Clover customer if parent doesn't have one yet
    if (!cloverCustomerId) {
      const customerRes = await axios.post(
        `${ecomBase}/v1/customers`,
        {
          email: parent.email,
          name: parent.fullName,
        },
        { headers },
      );
      cloverCustomerId = customerRes.data.id;
      console.log('✅ Created Clover customer:', cloverCustomerId);
    }

    // Save the card token to the customer — this returns a permanent card ID
    const cardRes = await axios.post(
      `${ecomBase}/v1/customers/${cloverCustomerId}/cards`,
      { token },
      { headers },
    );

    const savedCard = cardRes.data;
    console.log('✅ Saved Clover card:', {
      cardId: savedCard.id,
      last4: savedCard.last4,
      brand: savedCard.brand,
    });

    // Calculate first billing date (1 month from today)
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    // Update parent record
    await Parent.findByIdAndUpdate(parent._id, {
      cloverCustomerId,
      savedCardId: savedCard.id,
      savedCardLast4: savedCard.last4,
      savedCardBrand: savedCard.brand,
      subscription: {
        active: true,
        plan,
        packageName,
        amountCents,
        playerIds,
        season,
        year,
        eventId,
        nextBillingDate,
        startedAt: new Date(),
        cancelledAt: null,
        lastChargedAt: new Date(), // today's payment counts as first charge
        failedAttempts: 0,
        lastFailureReason: null,
      },
    });

    // Confirmation email
    try {
      await sendEmail({
        to: parent.email,
        subject: 'Auto-Pay Enabled — Partizan Basketball',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <div style="background: #594230; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
              <h1 style="margin: 0;">✅ Auto-Pay Enabled</h1>
            </div>
            <div style="background: white; padding: 20px; border-radius: 0 0 5px 5px;">
              <p>Hi ${parent.fullName},</p>
              <p>Monthly auto-pay has been set up successfully for your Partizan training subscription.</p>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #594230; margin: 15px 0;">
                <p><strong>Plan:</strong> ${packageName}</p>
                <p><strong>Amount:</strong> $${(amountCents / 100).toFixed(2)}/month</p>
                <p><strong>Card:</strong> ${savedCard.brand} ending in ${savedCard.last4}</p>
                <p><strong>First automatic charge:</strong> ${nextBillingDate.toLocaleDateString()}</p>
              </div>
              <p>You can cancel auto-pay at any time from your account dashboard.</p>
              <p>Questions? Email us at partizanhoops@proton.me</p>
            </div>
          </div>
        `,
      });
    } catch (emailError) {
      console.error('Failed to send auto-pay confirmation email:', emailError);
    }

    res.json({
      success: true,
      subscription: {
        active: true,
        plan,
        packageName,
        amountCents,
        nextBillingDate,
        cardLast4: savedCard.last4,
        cardBrand: savedCard.brand,
      },
    });
  } catch (error) {
    console.error('❌ Save card error:', error.response?.data || error.message);
    res.status(400).json({
      success: false,
      error: 'Failed to save card for auto-pay',
      message: error.response?.data?.message || error.message,
    });
  }
});

// ── POST /api/subscriptions/cancel ───────────────────────────────────────────
router.post('/cancel', authenticate, async (req, res) => {
  try {
    const parent = await Parent.findById(req.user.id);
    if (!parent) {
      return res
        .status(404)
        .json({ success: false, error: 'Parent not found' });
    }

    if (!parent.subscription?.active) {
      return res
        .status(400)
        .json({ success: false, error: 'No active subscription found' });
    }

    await Parent.findByIdAndUpdate(parent._id, {
      'subscription.active': false,
      'subscription.cancelledAt': new Date(),
      savedCardId: null,
      savedCardLast4: null,
      savedCardBrand: null,
    });

    // Optionally delete the card from Clover too
    if (parent.cloverCustomerId && parent.savedCardId) {
      try {
        const { config, ecomBase } = await getCloverConfig();
        await axios.delete(
          `${ecomBase}/v1/customers/${parent.cloverCustomerId}/cards/${parent.savedCardId}`,
          { headers: { Authorization: `Bearer ${config.accessToken}` } },
        );
        console.log('✅ Deleted Clover card for parent:', parent._id);
      } catch (cloverError) {
        // Non-fatal — card may already be gone
        console.warn('Could not delete Clover card:', cloverError.message);
      }
    }

    try {
      await sendEmail({
        to: parent.email,
        subject: 'Auto-Pay Cancelled — Partizan Basketball',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <div style="background: #594230; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
              <h1 style="margin: 0;">Auto-Pay Cancelled</h1>
            </div>
            <div style="background: white; padding: 20px; border-radius: 0 0 5px 5px;">
              <p>Hi ${parent.fullName},</p>
              <p>Your monthly auto-pay has been successfully cancelled. No further charges will be made.</p>
              <p>To continue training, you can register and pay manually at any time.</p>
              <p>Questions? Email us at partizanhoops@proton.me</p>
            </div>
          </div>
        `,
      });
    } catch (emailError) {
      console.error('Failed to send cancellation email:', emailError);
    }

    res.json({ success: true, message: 'Auto-pay cancelled successfully' });
  } catch (error) {
    console.error('❌ Cancel subscription error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ── GET /api/subscriptions/status ────────────────────────────────────────────
router.get('/status', authenticate, async (req, res) => {
  try {
    const parent = await Parent.findById(req.user.id).select(
      'subscription savedCardLast4 savedCardBrand cloverCustomerId',
    );

    if (!parent) {
      return res
        .status(404)
        .json({ success: false, error: 'Parent not found' });
    }

    res.json({
      success: true,
      subscription: parent.subscription || null,
      savedCard: parent.savedCardLast4
        ? { last4: parent.savedCardLast4, brand: parent.savedCardBrand }
        : null,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
