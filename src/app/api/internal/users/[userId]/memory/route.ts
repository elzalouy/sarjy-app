import {
  handleCorrectMemory,
  handleForgetMemory,
  handleListMemory,
  handleRememberMemory,
} from "../../../../../../server/memory/internal-http.ts";

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { userId } = await context.params;
  return handleListMemory(request, userId);
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { userId } = await context.params;
  return handleRememberMemory(request, userId);
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { userId } = await context.params;
  return handleCorrectMemory(request, userId);
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { userId } = await context.params;
  return handleForgetMemory(request, userId);
}
