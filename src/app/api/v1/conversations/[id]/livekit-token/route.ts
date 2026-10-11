import { withCurrentUser } from "../../../../../../server/auth/auth-http.ts";
import { getServerConfig } from "../../../../../../server/config/env.ts";
import { conversationId } from "../../../../../../server/conversations/access.ts";
import {
  jsonData,
  mapConversationError,
} from "../../../../../../server/conversations/http.ts";
import { issueLivekitToken } from "../../../../../../server/conversations/issue-livekit-token.ts";

type RouteContext = { params: Promise<{ id: string }> };

export function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withCurrentUser(
    request,
    async (user, prisma) => {
      try {
        const { id } = await context.params;
        const livekit = getServerConfig().livekit;
        const issued = await issueLivekitToken(prisma, {
          userId: user.id,
          conversationId: conversationId(id),
          apiKey: livekit.apiKey,
          apiSecret: livekit.apiSecret,
          agentName: livekit.agentName,
          publicUrl: livekit.publicUrl,
        });
        return jsonData({
          token: issued.token,
          url: issued.url,
          expiresInSeconds: issued.expiresInSeconds,
        });
      } catch (error) {
        throw mapConversationError(error);
      }
    },
    { sameOrigin: true },
  );
}
