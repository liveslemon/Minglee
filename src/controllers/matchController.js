import * as matchService from "../services/matchService.js";
import { matchFeedbackSchema, matchIdParamSchema } from "../validators/matchSchemas.js";

export async function getCurrentMatch(req, res) {
  const match = await matchService.getCurrentMatch(req.user.id);
  return res.json({ match });
}

export async function submitFeedback(req, res) {
  const { id } = matchIdParamSchema.parse(req.params);
  const { rating } = matchFeedbackSchema.parse(req.body);
  const feedback = await matchService.submitMatchFeedback(req.user.id, id, rating);
  return res.status(201).json({ feedback });
}
