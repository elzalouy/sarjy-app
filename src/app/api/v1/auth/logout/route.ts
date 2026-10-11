import { handleLogoutRequest } from "../../../../../server/auth/auth-http.ts";

export function POST(request: Request): Promise<Response> {
  return handleLogoutRequest(request);
}