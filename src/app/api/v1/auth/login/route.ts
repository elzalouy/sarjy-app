import { handleLoginRequest } from "../../../../../server/auth/auth-http.ts";

export function POST(request: Request): Promise<Response> {
  return handleLoginRequest(request);
}
