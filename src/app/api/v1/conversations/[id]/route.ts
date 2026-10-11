import { withCurrentUser } from "../../../../../server/auth/auth-http.ts";
import { conversationId } from "../../../../../server/conversations/access.ts";
import {
  jsonData,
  mapConversationError,
} from "../../../../../server/conversations/http.ts";
import { getConversationForUser } from "../../../../../server/conversations/query-conversations.ts";

type RouteContext = { params: Promise<{ id: string }> };

export function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withCurrentUser(request, async (user, prisma) => {
    try {
      const { id } = await context.params;
      const conversation = await getConversationForUser(prisma, {
        userId: user.id,
        conversationId: conversationId(id),
      });
      return jsonData({ conversation });
    } catch (error) {
      throw mapConversationError(error);
    }
  });
}
