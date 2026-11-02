import { signAccessToken } from "../middleware/auth.js";
import { loginSchema, signupSchema } from "../validators/authSchemas.js";
import * as authService from "../services/authService.js";
import { trackWeeklyActiveUser } from "../services/weeklyActiveUsersService.js";

export async function signup(req, res) {
  const input = signupSchema.parse(req.body);
  const user = await authService.signup(input);
  trackWeeklyActiveUser(user.id);
  const access_token = signAccessToken({ userId: user.id, role: user.role });
  return res.status(201).json({
    user,
    access_token
  });
}

export async function login(req, res) {
  const input = loginSchema.parse(req.body);
  const user = await authService.login(input);
  trackWeeklyActiveUser(user.id);
  const access_token = signAccessToken({ userId: user.id, role: user.role });

  return res.json({
    user,
    access_token
  });
}
