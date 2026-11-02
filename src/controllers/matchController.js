import * as matchService from "../services/matchService.js";
import { matchFeedbackSchema } from "../validators/matchSchemas.js";
import { ApiError } from "../utils/apiError.js";

export async function getCurrentMatch(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const match = await matchService.getCurrentMatchForUser(userId);
  return res.json({ match });
}

export async function submitFeedback(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const { id } = req.params;
  const { rating } = matchFeedbackSchema.parse(req.body);

  const feedback = await matchService.submitMatchFeedback(userId, id, rating);
  return res.status(201).json({ feedback });
}
