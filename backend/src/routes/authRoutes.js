import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as authController from "../controllers/authController.js";

export const authRoutes = Router();

authRoutes.post("/signup", asyncHandler(authController.signup));
authRoutes.post("/login", asyncHandler(authController.login));

