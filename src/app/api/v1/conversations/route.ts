import { withCurrentUser } from "../../../../server/auth/auth-http.ts";
import { createConversationForUser } from "../../../../server/conversations/create-conversation.ts";
import {
  jsonData,
  mapConversationError,
} from "../../../../server/conversations/http.ts";
import {
  encodePageCursor,
  readPageCursor,
  readPageLimit,
} from "../../../../server/conversations/page-cursor.ts";
import { listConversationsForUser } from "../../../../server/conversations/query-conversations.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function POST(request: Request): Promise<Response> {
  return withCurrentUser(
    request,
    async (user, prisma) => {
      try {
        const conversation = await createConversationForUser(prisma, {
          userId: user.id,
        });
        return jsonData(
          { id: conversation.id, status: conversation.status },
          201,
        );
      } catch (error) {
        throw mapConversationError(error);
      }
    },
    { sameOrigin: true },
  );
}

export function GET(request: Request): Promise<Response> {
  return withCurrentUser(request, async (user, prisma) => {
    const url = new URL(request.url);
    const page = await listConversationsForUser(prisma, {
      userId: user.id,
      limit: readPageLimit(
        url.searchParams.get("limit"),
        DEFAULT_LIMIT,
        MAX_LIMIT,
      ),
      cursor: readPageCursor(url.searchParams.get("cursor")),
    });
    return jsonData({
      conversations: page.conversations,
      nextCursor:
        page.nextCursor === null ? null : encodePageCursor(page.nextCursor),
    });
  });
}
