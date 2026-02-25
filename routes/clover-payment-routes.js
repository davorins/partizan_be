// clover-payment-routes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios');
const { authenticate } = require('../utils/auth');
const Payment = require('../models/Payment');
const Parent = require('../models/Parent');
const Player = require('../models/Player');
const Registration = require('../models/Registration');
const Team = require('../models/Team');
const { sendEmail } = require('../utils/email');
const PaymentConfiguration = require('../models/PaymentConfiguration');

router.post('/clover/process', authenticate, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      token, // card token from frontend
      amount,
      email,
      players = [],
      teamIds = [],
      tournament,
      year,
      cardDetails,
      registrationType = 'player',
      metadata = {},
    } = req.body;

    const parentId = req.user.id;

    if (!amount || amount <= 0)
      throw new Error('Valid payment amount is required');
    if (!token) throw new Error('Payment token is required');
    if (!email) throw new Error('Email is required');

    // Get active Clover configuration
    const config = await PaymentConfiguration.findOne({
      isActive: true,
      paymentSystem: 'clover',
    });

    if (!config) throw new Error('No active Clover configuration found');

    const cloverConfig = config.cloverConfig;
    const baseURL =
      cloverConfig.environment === 'production'
        ? 'https://api.clover.com/v3'
        : 'https://apisandbox.dev.clover.com/v3';

    const axiosInstance = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${cloverConfig.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // 1️⃣ Create Clover order
    const orderPayload = {
      amount,
      currency: 'USD',
      email,
      referenceId: `parent:${parentId}`,
      note: `${registrationType} payment`,
    };

    const orderRes = await axiosInstance.post('/orders', orderPayload);
    const orderId = orderRes.data?.id;
    if (!orderId) throw new Error('Failed to create Clover order');

    // 2️⃣ Charge the card
    const paymentPayload = {
      orderId,
      amount,
      source: {
        type: 'card',
        token,
      },
      email,
    };

    const paymentRes = await axiosInstance.post('/charges', paymentPayload);
    const processedPayment = paymentRes.data;

    if (!processedPayment?.id || !processedPayment?.status) {
      throw new Error('Clover payment failed');
    }

    if (!['PAID', 'AUTHORIZED'].includes(processedPayment.status)) {
      throw new Error(`Payment failed with status: ${processedPayment.status}`);
    }

    // 3️⃣ Record payment in DB
    const parent = await Parent.findById(parentId).session(session);
    if (!parent) throw new Error('Parent not found');

    const paymentRecord = new Payment({
      parentId: parent._id,
      paymentId: processedPayment.id,
      orderId,
      paymentSystem: 'clover',
      buyerEmail: email,
      cardLastFour: cardDetails?.last_4 || 'N/A',
      cardBrand: cardDetails?.card_brand || 'N/A',
      cardExpMonth: cardDetails?.exp_month || '00',
      cardExpYear: cardDetails?.exp_year || '00',
      amount: amount / 100,
      currency: 'USD',
      status: processedPayment.status.toLowerCase(),
      processedAt: new Date(),
      merchantId: cloverConfig.merchantId,
      configurationId: config._id,
    });

    // Update players or teams
    if (registrationType === 'tournament') {
      paymentRecord.teamIds = teamIds;

      for (const teamId of teamIds) {
        const team = await Team.findOne({
          _id: teamId,
          coachIds: parentId,
        }).session(session);
        if (!team) continue;

        const tournamentData = {
          tournament,
          year: parseInt(year),
          paymentStatus: 'paid',
          paymentComplete: true,
          paymentDate: new Date(),
          paymentId: processedPayment.id,
          cardLast4: cardDetails?.last_4 || 'N/A',
          cardBrand: cardDetails?.card_brand || 'N/A',
          amountPaid: amount / 100 / teamIds.length,
        };

        if (!team.tournaments) team.tournaments = [];
        team.tournaments.push(tournamentData);
        team.paymentComplete = true;
        team.paymentStatus = 'paid';
        team.updatedAt = new Date();
        team.markModified('tournaments');
        await team.save({ session });
      }
    } else {
      // Player payments
      const perPlayerAmount = amount / 100 / players.length;
      for (const playerData of players) {
        const player = await Player.findOne({
          _id: playerData.playerId,
          parentId,
        }).session(session);
        if (!player) continue;

        const seasonIndex = player.seasons.findIndex(
          (s) =>
            s.season === playerData.season &&
            s.year === playerData.year &&
            s.tryoutId === playerData.tryoutId,
        );

        const seasonData = {
          season: playerData.season,
          year: playerData.year,
          tryoutId: playerData.tryoutId,
          paymentStatus: 'paid',
          paymentComplete: true,
          paymentId: processedPayment.id,
          amountPaid: perPlayerAmount,
          cardLast4: cardDetails?.last_4 || 'N/A',
          cardBrand: cardDetails?.card_brand || 'N/A',
          paymentDate: new Date(),
          registrationDate: new Date(),
        };

        if (seasonIndex >= 0)
          player.seasons[seasonIndex] = {
            ...player.seasons[seasonIndex],
            ...seasonData,
          };
        else player.seasons.push(seasonData);

        player.paymentStatus = 'paid';
        player.paymentComplete = true;
        player.registrationComplete = true;
        player.lastPaymentDate = new Date();
        player.markModified('seasons');
        await player.save({ session });

        // Update registration
        await Registration.findOneAndUpdate(
          {
            player: player._id,
            season: playerData.season,
            year: playerData.year,
            tryoutId: playerData.tryoutId,
            parent: parent._id,
          },
          {
            $set: {
              paymentStatus: 'paid',
              paymentComplete: true,
              paymentId: processedPayment.id,
              amountPaid: perPlayerAmount,
              cardLast4: cardDetails?.last_4 || 'N/A',
              cardBrand: cardDetails?.card_brand || 'N/A',
              paymentDate: new Date(),
              registrationComplete: true,
            },
          },
          { upsert: true, session },
        );
      }
    }

    await paymentRecord.save({ session });

    // Update parent
    parent.paymentComplete = true;
    parent.lastPaymentDate = new Date();
    parent.payments = parent.payments || [];
    parent.payments.push(paymentRecord._id);
    await parent.save({ session });

    // Send receipt email
    try {
      await sendEmail({
        to: email,
        subject: 'Payment Confirmation - Clover Payment',
        html: `
          <h2>Payment Successful</h2>
          <p>Amount: $${(amount / 100).toFixed(2)}</p>
          <p>Payment ID: ${processedPayment.id}</p>
          <p>Order ID: ${orderId}</p>
          <p>Status: ${processedPayment.status}</p>
          <p>Date: ${new Date().toLocaleDateString()}</p>
        `,
      });
    } catch (emailError) {
      console.warn('⚠️ Email sending failed:', emailError.message);
    }

    await session.commitTransaction();

    res.json({
      success: true,
      paymentId: paymentRecord._id,
      paymentSystem: 'clover',
      externalPaymentId: processedPayment.id,
      orderId,
      amount: amount / 100,
      status: processedPayment.status.toLowerCase(),
      receiptUrl: processedPayment.receipt_url || processedPayment.receiptUrl,
      message: 'Clover payment processed successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error(
      '❌ Clover payment processing failed:',
      error.response?.data || error.message,
    );
    res.status(400).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  } finally {
    session.endSession();
  }
});

module.exports = router;
