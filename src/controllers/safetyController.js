import * as safetyService from "../services/safetyService.js";
import { createReportSchema, userIdParamSchema } from "../validators/safetySchemas.js";

export async function createReport(req, res) {
  const input = createReportSchema.parse(req.body);
  const { report, created } = await safetyService.createReport(req.user.id, input);
  return res.status(created ? 201 : 200).json({ report });
}

export async function blockUser(req, res) {
  const { id } = userIdParamSchema.parse(req.params);
  const { block, created } = await safetyService.blockUser(req.user.id, id);
  return res.status(created ? 201 : 200).json({ block });
}
