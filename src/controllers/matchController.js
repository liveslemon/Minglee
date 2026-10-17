import * as matchService from "../services/matchService.js";

export async function getCurrentMatch(req, res) {
  const match = await matchService.getCurrentMatch(req.user.id);
  return res.json({ match });
}
