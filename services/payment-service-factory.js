const PaymentConfiguration = require('../models/PaymentConfiguration');

class PaymentServiceFactory {
  constructor() {
    this.services = new Map();
  }

  // REMOVE organizationId parameter - we don't need it!
  async getService(paymentSystem = null) {
    const cacheKey = paymentSystem || 'default';

    // Check cache
    if (this.services.has(cacheKey)) {
      return this.services.get(cacheKey);
    }

    // Find active payment configuration (NO organization filter!)
    const query = {
      isActive: true,
    };

    if (paymentSystem) {
      query.paymentSystem = paymentSystem;
    }

    const config = await PaymentConfiguration.findOne(query).sort({
      isDefault: -1,
    });

    if (!config) {
      throw new Error(
        `No active payment configuration found. Please configure payment settings in admin panel.`,
      );
    }

    // Create service instance
    let service;
    switch (config.paymentSystem) {
      case 'square':
        service = this.createSquareService(config);
        break;
      case 'clover':
        service = this.createCloverService(config);
        break;
      case 'stripe':
        service = this.createStripeService(config);
        break;
      case 'paypal':
        service = this.createPaypalService(config);
        break;
      default:
        throw new Error(`Unsupported payment system: ${config.paymentSystem}`);
    }

    // Cache the service
    this.services.set(cacheKey, service);

    return service;
  }

  createSquareService(config) {
    const { Client, Environment } = require('square');

    const client = new Client({
      accessToken: config.squareConfig.accessToken,
      environment:
        config.squareConfig.environment === 'production'
          ? Environment.Production
          : Environment.Sandbox,
    });

    return {
      type: 'square',
      client,
      config: config.squareConfig,
      settings: config.settings,

      async processPayment(paymentData) {
        const { paymentsApi } = this.client;

        const paymentRequest = {
          idempotencyKey: `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sourceId: paymentData.sourceId,
          amountMoney: {
            amount: paymentData.amount,
            currency: this.settings.currency || 'USD',
          },
          locationId: this.config.locationId,
          autocomplete: true,
          referenceId: paymentData.referenceId,
          note: paymentData.note || this.settings.defaultPaymentDescription,
          buyerEmailAddress: paymentData.email,
        };

        const { result } = await paymentsApi.createPayment(paymentRequest);
        return result.payment;
      },

      async refundPayment(paymentId, amount, reason) {
        const { refundsApi } = this.client;

        const refundRequest = {
          idempotencyKey: `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          paymentId,
          amountMoney: {
            amount,
            currency: this.settings.currency || 'USD',
          },
          reason,
        };

        const { result } = await refundsApi.refundPayment(refundRequest);
        return result.refund;
      },

      async getPaymentDetails(paymentId) {
        const { paymentsApi } = this.client;
        const { result } = await paymentsApi.getPayment(paymentId);
        return result.payment;
      },
    };
  }

  createCloverService(config) {
    const clover = require('clover-sdk');
    const cloverClient = new clover.ApiClient();

    cloverClient.basePath =
      config.cloverConfig.environment === 'production'
        ? 'https://api.clover.com/v3'
        : 'https://sandbox.dev.clover.com/v3';
    cloverClient.authentications['oauth'].accessToken =
      config.cloverConfig.accessToken;

    const ordersApi = new clover.OrdersApi(cloverClient);
    const paymentsApi = new clover.PaymentsApi(cloverClient);

    return {
      type: 'clover',
      client: cloverClient,
      config: config.cloverConfig,
      settings: config.settings,

      async processPayment(paymentData) {
        // Create order
        const order = {
          total: paymentData.amount,
          currency: this.settings.currency || 'USD',
          note: paymentData.note || this.settings.defaultPaymentDescription,
          email: paymentData.email,
          manualTransaction: false,
        };

        const orderResponse = await ordersApi.createOrder(
          this.config.merchantId,
          order,
        );
        const cloverOrder = orderResponse.data;

        // Process payment
        const paymentRequest = {
          orderId: cloverOrder.id,
          amount: paymentData.amount,
          currency: this.settings.currency || 'USD',
          source: paymentData.sourceId,
          offline: false,
          tipAmount: 0,
          taxAmount: 0,
          externalPaymentId: paymentData.referenceId,
          note: paymentData.note || this.settings.defaultPaymentDescription,
        };

        const paymentResponse = await paymentsApi.createPayment(
          this.config.merchantId,
          paymentRequest,
        );
        return {
          ...paymentResponse.data,
          orderId: cloverOrder.id,
        };
      },

      async refundPayment(paymentId, amount, reason) {
        const refundsApi = new clover.RefundsApi(this.client);

        const refundRequest = {
          paymentId,
          amount,
          reason,
        };

        const refundResponse = await refundsApi.createRefund(
          this.config.merchantId,
          refundRequest,
        );
        return refundResponse.data;
      },

      async getPaymentDetails(paymentId) {
        const paymentResponse = await paymentsApi.getPayment(
          this.config.merchantId,
          paymentId,
        );
        return paymentResponse.data;
      },
    };
  }

  createStripeService(config) {
    const stripe = require('stripe')(config.stripeConfig.secretKey);

    return {
      type: 'stripe',
      client: stripe,
      config: config.stripeConfig,
      settings: config.settings,

      async processPayment(paymentData) {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: paymentData.amount,
          currency: this.settings.currency || 'USD',
          payment_method: paymentData.sourceId,
          confirmation_method: 'automatic',
          confirm: true,
          description:
            paymentData.note || this.settings.defaultPaymentDescription,
          metadata: {
            referenceId: paymentData.referenceId,
          },
          receipt_email: paymentData.email,
        });

        return paymentIntent;
      },

      async refundPayment(paymentId, amount, reason) {
        const refund = await stripe.refunds.create({
          payment_intent: paymentId,
          amount,
          reason,
        });

        return refund;
      },

      async getPaymentDetails(paymentId) {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
        return paymentIntent;
      },
    };
  }

  createPaypalService(config) {
    const paypal = require('@paypal/checkout-server-sdk');

    let environment;
    if (config.paypalConfig.environment === 'production') {
      environment = new paypal.core.LiveEnvironment(
        config.paypalConfig.clientId,
        config.paypalConfig.clientSecret,
      );
    } else {
      environment = new paypal.core.SandboxEnvironment(
        config.paypalConfig.clientId,
        config.paypalConfig.clientSecret,
      );
    }

    const client = new paypal.core.PayPalHttpClient(environment);

    return {
      type: 'paypal',
      client,
      config: config.paypalConfig,
      settings: config.settings,

      async processPayment(paymentData) {
        const request = new paypal.orders.OrdersCreateRequest();
        request.requestBody({
          intent: 'CAPTURE',
          purchase_units: [
            {
              amount: {
                currency_code: this.settings.currency || 'USD',
                value: (paymentData.amount / 100).toFixed(2), // Convert cents to dollars
              },
              description:
                paymentData.note || this.settings.defaultPaymentDescription,
              custom_id: paymentData.referenceId,
            },
          ],
          application_context: {
            brand_name: 'Basketball Camp',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: paymentData.returnUrl,
            cancel_url: paymentData.cancelUrl,
          },
        });

        const response = await client.execute(request);

        // Capture the payment
        const captureRequest = new paypal.orders.OrdersCaptureRequest(
          response.result.id,
        );
        const captureResponse = await client.execute(captureRequest);

        return captureResponse.result;
      },

      async refundPayment(captureId, amount, reason) {
        const request = new paypal.payments.CapturesRefundRequest(captureId);
        request.requestBody({
          amount: {
            currency_code: this.settings.currency || 'USD',
            value: (amount / 100).toFixed(2),
          },
          note_to_payer: reason,
        });

        const response = await client.execute(request);
        return response.result;
      },

      async getPaymentDetails(orderId) {
        const request = new paypal.orders.OrdersGetRequest(orderId);
        const response = await client.execute(request);
        return response.result;
      },
    };
  }

  // Clear cache (simplified - no organization)
  clearCache(paymentSystem = null) {
    if (paymentSystem) {
      this.services.delete(paymentSystem);
    } else {
      this.services.clear();
    }
  }

  // Switch payment system easily
  async switchPaymentSystem(paymentSystem) {
    this.clearCache(paymentSystem);
    return this.getService(paymentSystem);
  }

  // Get current active payment system
  async getCurrentPaymentSystem() {
    const service = await this.getService();
    return service.type;
  }
}

// Export singleton instance
module.exports = new PaymentServiceFactory();
