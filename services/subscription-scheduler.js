const cron = require('node-cron');
const mongoose = require('mongoose');
const axios = require('axios');
const Parent = require('../models/Parent');
const Payment = require('../models/Payment');
const PaymentConfiguration = require('../models/PaymentConfiguration');
const { sendEmail } = require('../utils/email');

const MAX_FAILED_ATTEMPTS = 3;

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

async function chargeSubscriptions() {
  console.log('🔄 [Scheduler] Running subscription billing check...');

  const now = new Date();

  // Find all active subscriptions due today or overdue
  const dueParents = await Parent.find({
    'subscription.active': true,
    'subscription.nextBillingDate': { $lte: now },
    savedCardId: { $ne: null },
    'subscription.failedAttempts': { $lt: MAX_FAILED_ATTEMPTS },
  });

  console.log(`[Scheduler] Found ${dueParents.length} subscription(s) due`);

  if (dueParents.length === 0) return;

  let { config, ecomBase } = await getCloverConfig();
  const headers = {
    Authorization: `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json',
  };

  for (const parent of dueParents) {
    const sub = parent.subscription;

    try {
      console.log(
        `[Scheduler] Charging parent ${parent._id} — $${(sub.amountCents / 100).toFixed(2)}`,
      );

      // Charge the saved card using customer + card ID
      const chargeRes = await axios.post(
        `${ecomBase}/v1/charges`,
        {
          amount: sub.amountCents,
          currency: 'usd',
          customer: parent.cloverCustomerId,
          source: parent.savedCardId,
          description: `Monthly auto-pay: ${sub.packageName}`,
          email: parent.email,
        },
        { headers },
      );

      const charge = chargeRes.data;
      console.log(`✅ [Scheduler] Charged parent ${parent._id}:`, charge.id);

      // Advance next billing date by 1 month
      const nextBillingDate = new Date(sub.nextBillingDate);
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

      await Parent.findByIdAndUpdate(parent._id, {
        'subscription.nextBillingDate': nextBillingDate,
        'subscription.lastChargedAt': new Date(),
        'subscription.failedAttempts': 0,
        'subscription.lastFailureReason': null,
      });

      // Create Payment record for this auto-charge
      await Payment.create({
        parentId: parent._id,
        playerIds: sub.playerIds || [],
        paymentId: charge.id || `autopay_${Date.now()}_${parent._id}`,
        paymentSystem: 'clover',
        configurationId: (
          await PaymentConfiguration.findOne({
            isActive: true,
            paymentSystem: 'clover',
          })
        )._id,
        merchantId: config.merchantId,
        amount: sub.amountCents / 100,
        currency: 'USD',
        status: 'completed',
        buyerEmail: parent.email,
        cardLastFour: parent.savedCardLast4 || '0000',
        cardBrand: parent.savedCardBrand || 'UNKNOWN',
        cardExpMonth: '00',
        cardExpYear: '00',
        paymentType: 'training',
        note: `Auto-pay: ${sub.packageName}`,
        processedAt: new Date(),
        players: (sub.playerIds || []).map((pid) => ({
          playerId: pid,
          season: sub.season,
          year: sub.year,
          tryoutId: sub.eventId || 'training',
        })),
      });

      // Email receipt
      try {
        await sendEmail({
          to: parent.email,
          subject: 'Monthly Auto-Pay Processed — Partizan Basketball',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
              <div style="background: #594230; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
                <h1 style="margin: 0;">🏀 Monthly Payment Processed</h1>
              </div>
              <div style="background: white; padding: 20px; border-radius: 0 0 5px 5px;">
                <p>Hi ${parent.fullName},</p>
                <p>Your monthly training payment has been automatically processed.</p>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #594230; margin: 15px 0;">
                  <p><strong>Plan:</strong> ${sub.packageName}</p>
                  <p><strong>Amount:</strong> $${(sub.amountCents / 100).toFixed(2)}</p>
                  <p><strong>Card:</strong> ${parent.savedCardBrand} ending in ${parent.savedCardLast4}</p>
                  <p><strong>Next charge:</strong> ${nextBillingDate.toLocaleDateString()}</p>
                </div>
                <p>To cancel auto-pay, visit your account dashboard.</p>
              </div>
            </div>
          `,
        });
      } catch (emailError) {
        console.error('[Scheduler] Receipt email failed:', emailError.message);
      }
    } catch (error) {
      const failureReason = error.response?.data?.message || error.message;
      console.error(
        `❌ [Scheduler] Failed to charge parent ${parent._id}:`,
        failureReason,
      );

      const newFailedAttempts = (sub.failedAttempts || 0) + 1;
      const shouldCancel = newFailedAttempts >= MAX_FAILED_ATTEMPTS;

      await Parent.findByIdAndUpdate(parent._id, {
        'subscription.failedAttempts': newFailedAttempts,
        'subscription.lastFailureReason': failureReason,
        ...(shouldCancel && {
          'subscription.active': false,
          'subscription.cancelledAt': new Date(),
        }),
      });

      // Notify parent of failure
      try {
        await sendEmail({
          to: parent.email,
          subject: shouldCancel
            ? 'Auto-Pay Cancelled After Failed Attempts — Partizan Basketball'
            : 'Auto-Pay Payment Failed — Partizan Basketball',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
              <div style="background: #c0392b; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
                <h1 style="margin: 0;">⚠️ Payment ${shouldCancel ? 'Cancelled' : 'Failed'}</h1>
              </div>
              <div style="background: white; padding: 20px; border-radius: 0 0 5px 5px;">
                <p>Hi ${parent.fullName},</p>
                ${
                  shouldCancel
                    ? `<p>Your auto-pay has been cancelled after ${MAX_FAILED_ATTEMPTS} failed attempts. Please log in and register manually to continue training.</p>`
                    : `<p>We were unable to process your monthly payment of <strong>$${(sub.amountCents / 100).toFixed(2)}</strong>. We will retry up to ${MAX_FAILED_ATTEMPTS - newFailedAttempts} more time(s).</p>`
                }
                <p>Please update your payment method or contact us at partizanhoops@proton.me.</p>
              </div>
            </div>
          `,
        });
      } catch (emailError) {
        console.error('[Scheduler] Failure email failed:', emailError.message);
      }
    }
  }

  console.log('[Scheduler] Billing run complete');
}

// Run daily at 8 AM
function startScheduler() {
  cron.schedule('0 8 * * *', async () => {
    try {
      await chargeSubscriptions();
    } catch (error) {
      console.error('❌ [Scheduler] Fatal error during billing run:', error);
    }
  });

  console.log('✅ Subscription scheduler started (daily at 8 AM)');
}

module.exports = { startScheduler, chargeSubscriptions };
