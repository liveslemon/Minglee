import { paymentService } from "./paymentService.js";
import { initializePaymentSchema, verifyPaymentSchema } from "./paymentValidator.js";

export const paymentController = {
  async initializePayment(req, res, next) {
    try {
      const validated = initializePaymentSchema.parse(req.body);
      const result = await paymentService.initializePayment({ ...validated, userId: req.user.id });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async verifyPayment(req, res, next) {
    try {
      const { reference } = verifyPaymentSchema.parse(req.params);
      const result = await paymentService.verifyPayment(reference, { userId: req.user.id });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async handleWebhook(req, res, next) {
    try {
      const signature = req.headers["x-paystack-signature"];
      if (!paymentService.verifyWebhookSignature(req.rawBody, signature)) {
        return res.status(401).json({ success: false, error: "Invalid webhook signature" });
      }

      const result = await paymentService.handleWebhook(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async getUserTickets(req, res, next) {
    try {
      const tickets = await paymentService.getUserTickets(req.user.id);
      res.json({ success: true, data: tickets });
    } catch (error) {
      next(error);
    }
  }
};
