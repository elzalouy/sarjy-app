import { handleAuthorizeVoiceSession } from "../../../../../server/conversations/internal-http.ts";

export function POST(request: Request): Promise<Response> {
  return handleAuthorizeVoiceSession(request);
}
