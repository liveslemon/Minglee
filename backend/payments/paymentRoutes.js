import { Router } from "express";
import { paymentController } from "./paymentController.js";
import { authMiddleware } from "../../src/middleware/auth.js";

export const paymentRoutes = Router();

paymentRoutes.post("/initialize", authMiddleware, paymentController.initializePayment);
paymentRoutes.get("/verify/:reference", authMiddleware, paymentController.verifyPayment);
// Gateway-to-server call: authenticated by HMAC signature, not JWT.
paymentRoutes.post("/webhook", paymentController.handleWebhook);
paymentRoutes.get("/tickets", authMiddleware, paymentController.getUserTickets);
