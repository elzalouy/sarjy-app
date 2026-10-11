import { handleCurrentUserRequest } from "../../../../../server/auth/auth-http.ts";

export function GET(request: Request): Promise<Response> {
  return handleCurrentUserRequest(request);
}
