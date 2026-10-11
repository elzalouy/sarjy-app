import { withCurrentUser } from "../../../../../../server/auth/auth-http.ts";
import { conversationId } from "../../../../../../server/conversations/access.ts";
import { endConversationForUser } from "../../../../../../server/conversations/end-conversation.ts";
import {
  jsonData,
  mapConversationError,
} from "../../../../../../server/conversations/http.ts";

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
        const conversation = await endConversationForUser(prisma, {
          userId: user.id,
          conversationId: conversationId(id),
          now: new Date(),
        });
        return jsonData({ conversation });
      } catch (error) {
        throw mapConversationError(error);
      }
    },
    { sameOrigin: true },
  );
}
