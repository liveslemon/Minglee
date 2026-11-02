import * as messageService from "../services/messageService.js";
import { sendMessageSchema } from "../validators/messageSchemas.js";
import { ApiError } from "../utils/apiError.js";

export async function listMessages(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const { id } = req.params;
  const { after } = req.query;

  const messages = await messageService.listMatchMessages(userId, id, after);
  return res.json({ messages });
}

export async function sendMessage(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const { id } = req.params;
  const { body } = sendMessageSchema.parse(req.body);

  const message = await messageService.sendMatchMessage(userId, id, body);
  return res.status(201).json({ message });
}
