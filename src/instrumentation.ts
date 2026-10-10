import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { installSafeConsole } = await import("./server/shared/request-log");
  const { getServerConfig } = await import("./server/config/env");
  installSafeConsole();
  getServerConfig();

  const { verifyDatabaseConnection } =
    await import("./server/database/connectivity");
  await verifyDatabaseConnection();
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { logFailedRequest } = await import("./server/shared/request-log");
  logFailedRequest(error, request);
};
