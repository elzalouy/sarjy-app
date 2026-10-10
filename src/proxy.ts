import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  readRequestId,
  REQUEST_ID_HEADER,
  REQUEST_START_HEADER,
} from "./server/shared/request-log";

export function proxy(request: NextRequest) {
  const requestId = readRequestId(request.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set(REQUEST_START_HEADER, String(Date.now()));

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
