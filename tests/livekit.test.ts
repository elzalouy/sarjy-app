import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { TokenVerifier } from "livekit-server-sdk";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        url: "data:text/javascript,export {}",
        shortCircuit: true,
      };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !specifier.endsWith(".ts") &&
      context.parentURL?.includes("/src/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { createParticipantToken } =
  await import("../src/server/integrations/livekit-token.ts");
const { assertServiceCredential, serviceCallSignal } =
  await import("../src/server/integrations/service-auth.ts");
const { hashSessionToken } =
  await import("../src/server/auth/session-token.ts");
const { createPrismaClient } = await import("../src/server/database/prisma.ts");
const { POST: tokenPost } =
  await import("../src/app/api/v1/conversations/[id]/livekit-token/route.ts");
const { POST: authorizePost } =
  await import("../src/app/api/internal/voice-sessions/authorize/route.ts");
const { POST: transcriptPost } =
  await import("../src/app/api/internal/conversations/[id]/transcripts/route.ts");

const root = path.resolve(import.meta.dirname, "..");
const apiKey = "livekit-test-api-key";
const apiSecret = "livekit-test-api-secret-value";

test("browser source does not contain LiveKit or agent secrets", async () => {
  const files = [
    ...(await listFiles(path.join(root, "src/app"))),
    ...(await listFiles(path.join(root, "src/features"))),
    ...(await listFiles(path.join(root, "src/components"))),
  ];
  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (
      source.includes("LIVEKIT_API_SECRET") ||
      source.includes("LIVEKIT_API_KEY") ||
      source.includes("INTERNAL_SERVICE_TOKEN")
    ) {
      violations.push(path.relative(root, file));
    }
  }
  assert.deepEqual(violations, []);
});

test("a participant token is room scoped and can dispatch the agent", async () => {
  const roomName = "room_abc123";
  const userId = "11111111-1111-4111-8111-111111111111";
  const conversationId = "22222222-2222-4222-8222-222222222222";
  const token = await createParticipantToken({
    apiKey,
    apiSecret,
    identity: userId,
    roomName,
    agentName: "sarjy",
    conversationId,
  });
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);

  assert.equal(claims.sub, userId);
  assert.equal(claims.video?.room, roomName);
  assert.equal(claims.video?.roomJoin, true);
  assert.equal(claims.video?.canPublish, true);
  assert.equal(claims.video?.canSubscribe, true);
  assert.equal(claims.video?.roomAdmin, false);
  assert.equal(claims.video?.roomCreate, false);
  assert.equal(claims.video?.roomList, false);
  assert.equal(claims.video?.roomRecord, false);
  assert.deepEqual(claims.video?.canPublishSources, ["microphone"]);
  assert.equal(claims.roomConfig?.agents[0]?.agentName, "sarjy");
  assert.equal(
    claims.roomConfig?.agents[0]?.metadata,
    JSON.stringify({ conversationId }),
  );
  assert.equal(token.includes(apiSecret), false);
  assert.equal(JSON.stringify(claims).includes(apiSecret), false);
});

test("internal auth accepts the current or previous token and times out calls", async () => {
  const current = "current-internal-service-token-value";
  const previous = "previous-internal-service-token-value";
  const tokens = { current, previous };

  assert.doesNotThrow(() =>
    assertServiceCredential(bearerRequest(current), tokens),
  );
  assert.doesNotThrow(() =>
    assertServiceCredential(bearerRequest(previous), tokens),
  );
  assert.throws(() => assertServiceCredential(bearerRequest("nope"), tokens));
  assert.throws(() =>
    assertServiceCredential(new Request("http://127.0.0.1/"), tokens),
  );

  const signal = serviceCallSignal(20);
  await new Promise((resolve) => {
    signal.addEventListener("abort", resolve, { once: true });
  });
  assert.equal(signal.aborted, true);
});

test("token, authorize, and transcript routes keep each user in their own room", async (t) => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  if (
    databaseUrl === undefined ||
    databaseUrl.length === 0 ||
    sessionSecret === undefined ||
    sessionSecret.length === 0 ||
    serviceToken === undefined ||
    serviceToken.length === 0
  ) {
    t.skip("Database or service settings are not set.");
    return;
  }

  const prisma = createPrismaClient(databaseUrl);
  const cookieName = process.env.SESSION_COOKIE_NAME?.trim() || "sarjy_session";
  const owner = await createAccount(prisma, sessionSecret);
  const other = await createAccount(prisma, sessionSecret);
  const conversation = await prisma.conversation.create({
    data: {
      userId: owner.userId,
      roomName: `room_${randomBytes(16).toString("hex")}`,
      status: "active",
    },
  });

  try {
    const anonymous = await tokenPost(
      new Request(
        `http://127.0.0.1/api/v1/conversations/${conversation.id}/livekit-token`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    assert.equal(anonymous.status, 401);

    const stolen = await tokenPost(
      authed(cookieName, other.token, conversation.id, {
        userId: owner.userId,
        roomName: conversation.roomName,
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    const stolenBody = await stolen.text();
    assert.equal(stolen.status, 404);
    assert.equal(stolenBody.includes(owner.userId), false);
    assert.equal(stolenBody.includes(apiSecret), false);

    const issued = await tokenPost(
      authed(cookieName, owner.token, conversation.id, {
        userId: other.userId,
        roomName: "room_not_this_one",
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    const issuedBody = (await issued.json()) as {
      token: string;
      url: string;
      expiresInSeconds: number;
    };
    assert.equal(issued.status, 200);
    assert.equal(issuedBody.expiresInSeconds, 600);
    assert.equal(
      issuedBody.url.startsWith("ws://") || issuedBody.url.startsWith("wss://"),
      true,
    );
    const livekitSecret = process.env.LIVEKIT_API_SECRET ?? "";
    const livekitKey = process.env.LIVEKIT_API_KEY ?? "";
    assert.equal(JSON.stringify(issuedBody).includes(livekitSecret), false);
    assert.equal(JSON.stringify(issuedBody).includes(livekitKey), false);
    const claims = await new TokenVerifier(livekitKey, livekitSecret).verify(
      issuedBody.token,
    );
    assert.equal(claims.sub, owner.userId);
    assert.equal(claims.video?.room, conversation.roomName);
    assert.equal(claims.video?.roomAdmin, false);

    const unauthenticated = await authorizePost(
      jsonRequest("http://127.0.0.1/api/internal/voice-sessions/authorize", {
        conversationId: conversation.id,
        roomName: conversation.roomName,
      }),
    );
    assert.equal(unauthenticated.status, 401);

    const swapped = await authorizePost(
      jsonRequest(
        "http://127.0.0.1/api/internal/voice-sessions/authorize",
        {
          conversationId: conversation.id,
          roomName: conversation.roomName,
          userId: other.userId,
        },
        serviceToken,
      ),
    );
    const swappedBody = await swapped.text();
    assert.equal(swapped.status, 404);
    assert.equal(swappedBody.includes(owner.userId), false);

    const authorized = await authorizePost(
      jsonRequest(
        "http://127.0.0.1/api/internal/voice-sessions/authorize",
        {
          conversationId: conversation.id,
          roomName: conversation.roomName,
        },
        serviceToken,
      ),
    );
    const authorizedBody = (await authorized.json()) as {
      conversationId: string;
      userId: string;
      roomName: string;
    };
    assert.equal(authorized.status, 200);
    assert.equal(authorizedBody.userId, owner.userId);
    assert.equal(authorizedBody.conversationId, conversation.id);
    assert.equal(authorizedBody.roomName, conversation.roomName);
    assert.equal(JSON.stringify(authorizedBody).includes("password"), false);

    const first = await transcriptPost(
      jsonRequest(
        `http://127.0.0.1/api/internal/conversations/${conversation.id}/transcripts`,
        {
          userId: owner.userId,
          role: "user",
          content: "hello from the call",
          eventId: "event-once",
        },
        serviceToken,
      ),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    const firstBody = (await first.json()) as {
      message: { id: string; content: string };
    };
    assert.equal(first.status, 201);
    assert.equal(firstBody.message.content, "hello from the call");

    const replay = await transcriptPost(
      jsonRequest(
        `http://127.0.0.1/api/internal/conversations/${conversation.id}/transcripts`,
        {
          userId: owner.userId,
          role: "assistant",
          content: "this replay must not replace the first text",
          eventId: "event-once",
        },
        serviceToken,
      ),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    const replayBody = (await replay.json()) as {
      message: { id: string; content: string };
    };
    assert.equal(replay.status, 200);
    assert.equal(replayBody.message.id, firstBody.message.id);
    assert.equal(replayBody.message.content, "hello from the call");
    assert.equal(
      await prisma.message.count({
        where: { conversationId: conversation.id },
      }),
      1,
    );

    const wrongOwner = await transcriptPost(
      jsonRequest(
        `http://127.0.0.1/api/internal/conversations/${conversation.id}/transcripts`,
        {
          userId: other.userId,
          role: "user",
          content: "should not be stored",
          eventId: "event-other",
        },
        serviceToken,
      ),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    const wrongOwnerBody = await wrongOwner.text();
    assert.equal(wrongOwner.status, 404);
    assert.equal(wrongOwnerBody.includes(owner.userId), false);
    assert.equal(
      await prisma.message.count({
        where: { conversationId: conversation.id },
      }),
      1,
    );

    const badRole = await transcriptPost(
      jsonRequest(
        `http://127.0.0.1/api/internal/conversations/${conversation.id}/transcripts`,
        {
          userId: owner.userId,
          role: "system",
          content: "nope",
        },
        serviceToken,
      ),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    assert.equal(badRole.status, 400);

    const huge = await transcriptPost(
      jsonRequest(
        `http://127.0.0.1/api/internal/conversations/${conversation.id}/transcripts`,
        {
          userId: owner.userId,
          role: "user",
          content: "x".repeat(8001),
        },
        serviceToken,
      ),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    assert.equal(huge.status, 400);
    assert.equal(
      await prisma.message.count({
        where: { conversationId: conversation.id },
      }),
      1,
    );
  } finally {
    await prisma.user.deleteMany({
      where: { id: { in: [owner.userId, other.userId] } },
    });
    await prisma.$disconnect();
  }
});

async function createAccount(
  prisma: ReturnType<typeof createPrismaClient>,
  sessionSecret: string,
): Promise<{ userId: string; token: string }> {
  const phone = `+1415556${String(randomInt(0, 10000)).padStart(4, "0")}`;
  const user = await prisma.user.create({
    data: {
      phoneNumber: phone,
      passwordHash: "stored-hash",
      status: "active",
    },
  });
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(sessionSecret, token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { userId: user.id, token };
}

function authed(
  cookieName: string,
  token: string,
  conversationId: string,
  body: unknown,
): Request {
  return new Request(
    `http://127.0.0.1/api/v1/conversations/${conversationId}/livekit-token`,
    {
      method: "POST",
      headers: {
        cookie: `${cookieName}=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function bearerRequest(token: string): Request {
  return new Request("http://127.0.0.1/internal", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function jsonRequest(url: string, body: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}
