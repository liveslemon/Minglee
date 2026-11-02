import { z } from "zod";
import * as safetyService from "../services/safetyService.js";
import { createReportSchema } from "../validators/safetySchemas.js";
import { ApiError } from "../utils/apiError.js";

const blockParamsSchema = z.object({ id: z.string().trim().uuid() }).strict();

export async function createReport(req, res) {
  const reporterId = req.user?.id;
  if (!reporterId) throw new ApiError(401, "Unauthorized");

  const { reported_user_id, reason } = createReportSchema.parse(req.body);
  const report = await safetyService.reportUser(reporterId, reported_user_id, reason);
  return res.status(201).json({ report });
}

export async function blockUser(req, res) {
  const blockerId = req.user?.id;
  if (!blockerId) throw new ApiError(401, "Unauthorized");

  const { id } = blockParamsSchema.parse(req.params);
  const block = await safetyService.blockUser(blockerId, id);
  return res.status(201).json({ block });
}
