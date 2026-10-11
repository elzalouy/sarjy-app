import { withCurrentUser } from "../../../../../../server/auth/auth-http.ts";
import { conversationId } from "../../../../../../server/conversations/access.ts";
import {
  jsonData,
  mapConversationError,
} from "../../../../../../server/conversations/http.ts";
import {
  encodePageCursor,
  readPageCursor,
  readPageLimit,
} from "../../../../../../server/conversations/page-cursor.ts";
import { listMessagesForUser } from "../../../../../../server/conversations/query-conversations.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type RouteContext = { params: Promise<{ id: string }> };

export function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withCurrentUser(request, async (user, prisma) => {
    try {
      const { id } = await context.params;
      const url = new URL(request.url);
      const page = await listMessagesForUser(prisma, {
        userId: user.id,
        conversationId: conversationId(id),
        limit: readPageLimit(
          url.searchParams.get("limit"),
          DEFAULT_LIMIT,
          MAX_LIMIT,
        ),
        cursor: readPageCursor(url.searchParams.get("cursor")),
      });
      return jsonData({
        messages: page.messages,
        nextCursor:
          page.nextCursor === null ? null : encodePageCursor(page.nextCursor),
      });
    } catch (error) {
      throw mapConversationError(error);
    }
  });
}
