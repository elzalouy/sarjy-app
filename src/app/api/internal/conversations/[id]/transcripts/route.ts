import { handleIngestTranscript } from "../../../../../../server/conversations/internal-http.ts";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  return handleIngestTranscript(request, id);
}
