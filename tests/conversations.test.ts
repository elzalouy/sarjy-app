import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";

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

const { InvalidConversationTransition, nextConversationStatus } =
  await import("../src/server/conversations/lifecycle.ts");
const { createMessage, InvalidMessageError } =
  await import("../src/server/database/conversations.ts");
const { createConversationForUser } =
  await import("../src/server/conversations/create-conversation.ts");
const { failConversationForUser } =
  await import("../src/server/conversations/fail-conversation.ts");
const { hashSessionToken } =
  await import("../src/server/auth/session-token.ts");
const { createPrismaClient } = await import("../src/server/database/prisma.ts");
const { POST: createPost, GET: listGet } =
  await import("../src/app/api/v1/conversations/route.ts");
const { GET: getOne } =
  await import("../src/app/api/v1/conversations/[id]/route.ts");
const { GET: listMessagesRoute } =
  await import("../src/app/api/v1/conversations/[id]/messages/route.ts");
const { POST: endPost } =
  await import("../src/app/api/v1/conversations/[id]/end/route.ts");

const root = path.resolve(import.meta.dirname, "..");

test("conversation transitions stay in a valid lifecycle", () => {
  assert.equal(nextConversationStatus("active", "end"), "ended");
  assert.equal(nextConversationStatus("active", "fail"), "failed");
  assert.equal(nextConversationStatus("ended", "end"), "ended");
  assert.equal(nextConversationStatus("failed", "end"), "failed");
  assert.equal(nextConversationStatus("failed", "fail"), "failed");
  assert.throws(
    () => nextConversationStatus("ended", "fail"),
    InvalidConversationTransition,
  );
});

test("conversation migration stores ownership and order indexes", async () => {
  const sql = await readFile(
    path.join(
      root,
      "prisma/migrations/20261010113754_add_conversations/migration.sql",
    ),
    "utf8",
  );
  assert.match(sql, /FOREIGN KEY \("user_id"\) REFERENCES "users"\("id"\)/);
  assert.match(
    sql,
    /FOREIGN KEY \("conversation_id"\) REFERENCES "conversations"\("id"\)/,
  );
  assert.match(sql, /CREATE INDEX "conversations_user_id_created_at_idx"/);
  assert.match(sql, /CREATE INDEX "messages_conversation_id_created_at_idx"/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "messages_conversation_id_provider_event_id_key"/,
  );
});

test("conversation routes enforce ownership, order, and ending", async (t) => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (
    databaseUrl === undefined ||
    databaseUrl.length === 0 ||
    sessionSecret === undefined ||
    sessionSecret.length === 0
  ) {
    t.skip("DATABASE_URL or SESSION_SECRET is not set.");
    return;
  }

  const prisma = createPrismaClient(databaseUrl);
  const cookieName = process.env.SESSION_COOKIE_NAME?.trim() || "sarjy_session";
  const owner = await createAccount(prisma, sessionSecret);
  const other = await createAccount(prisma, sessionSecret);

  try {
    const anonymous = await createPost(
      new Request("http://127.0.0.1/api/v1/conversations", { method: "POST" }),
    );
    assert.equal(anonymous.status, 401);

    const blocked = await createPost(
      new Request("http://127.0.0.1/api/v1/conversations", {
        method: "POST",
        headers: {
          cookie: sessionCookie(cookieName, owner.token),
          origin: "https://evil.example",
        },
      }),
    );
    assert.equal(blocked.status, 403);

    const created = await createPost(authed(cookieName, owner.token, "POST"));
    const createdBody = (await created.json()) as {
      id: string;
      status: string;
    };
    assert.equal(created.status, 201);
    assert.equal(createdBody.status, "active");
    assert.equal(JSON.stringify(createdBody).includes("room_"), false);
    assert.equal(JSON.stringify(createdBody).includes(owner.userId), false);

    const stored = await prisma.conversation.findUnique({
      where: { id: createdBody.id },
    });
    assert.equal(stored?.userId, owner.userId);
    assert.equal(stored?.status, "active");
    assert.equal(stored?.endedAt, null);
    assert.match(stored?.roomName ?? "", /^room_[0-9a-f]{32}$/);

    const second = await createConversationForUser(prisma, {
      userId: owner.userId,
    });
    const foreign = await createConversationForUser(prisma, {
      userId: other.userId,
    });

    const listed = await listGet(
      authed(cookieName, owner.token, "GET", "/api/v1/conversations?limit=1"),
    );
    const listedBody = (await listed.json()) as {
      conversations: Array<{ id: string }>;
      nextCursor: string | null;
    };
    assert.equal(listed.status, 200);
    assert.equal(listedBody.conversations.length, 1);
    assert.equal(
      listedBody.conversations.some((item) => item.id === foreign.id),
      false,
    );
    assert.equal(typeof listedBody.nextCursor, "string");

    const rest = await listGet(
      authed(
        cookieName,
        owner.token,
        "GET",
        `/api/v1/conversations?limit=10&cursor=${listedBody.nextCursor}`,
      ),
    );
    const restBody = (await rest.json()) as {
      conversations: Array<{ id: string }>;
    };
    const seen = [
      ...listedBody.conversations.map((item) => item.id),
      ...restBody.conversations.map((item) => item.id),
    ];
    assert.equal(seen.includes(createdBody.id), true);
    assert.equal(seen.includes(second.id), true);
    assert.equal(seen.includes(foreign.id), false);

    const own = await getOne(
      authed(
        cookieName,
        owner.token,
        "GET",
        `/api/v1/conversations/${createdBody.id}`,
      ),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    const ownBody = (await own.json()) as {
      conversation: { id: string; status: string; roomName?: string };
    };
    assert.equal(own.status, 200);
    assert.equal(ownBody.conversation.id, createdBody.id);
    assert.equal(ownBody.conversation.roomName, undefined);

    const guessed = await getOne(
      authed(
        cookieName,
        other.token,
        "GET",
        `/api/v1/conversations/${createdBody.id}`,
      ),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    assert.equal(guessed.status, 404);

    const firstAt = new Date("2026-10-10T12:00:00.000Z");
    const secondAt = new Date("2026-10-10T12:00:01.000Z");
    const thirdAt = new Date("2026-10-10T12:00:02.000Z");
    const firstMessage = await createMessage(prisma, {
      conversationId: createdBody.id,
      role: "user",
      content: "hello",
      createdAt: firstAt,
      providerEventId: "event-1",
    });
    const duplicate = await createMessage(prisma, {
      conversationId: createdBody.id,
      role: "assistant",
      content: "different",
      createdAt: thirdAt,
      providerEventId: "event-1",
    });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.message.id, firstMessage.message.id);
    await createMessage(prisma, {
      conversationId: createdBody.id,
      role: "assistant",
      content: "reply",
      createdAt: secondAt,
    });
    await createMessage(prisma, {
      conversationId: createdBody.id,
      role: "user",
      content: "again",
      createdAt: thirdAt,
    });
    const secret = "x".repeat(8001);
    await assert.rejects(
      () =>
        createMessage(prisma, {
          conversationId: createdBody.id,
          role: "user",
          content: secret,
        }),
      (error: unknown) => {
        assert.ok(error instanceof InvalidMessageError);
        assert.equal(error.message.includes(secret), false);
        return true;
      },
    );

    const messagePage = await listMessagesRoute(
      authed(
        cookieName,
        owner.token,
        "GET",
        `/api/v1/conversations/${createdBody.id}/messages?limit=2`,
      ),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    const messageBody = (await messagePage.json()) as {
      messages: Array<{ content: string; providerEventId?: string }>;
      nextCursor: string | null;
    };
    assert.equal(messagePage.status, 200);
    assert.deepEqual(
      messageBody.messages.map((message) => message.content),
      ["hello", "reply"],
    );
    assert.equal(messageBody.messages[0]?.providerEventId, undefined);
    assert.equal(typeof messageBody.nextCursor, "string");

    const messageRest = await listMessagesRoute(
      authed(
        cookieName,
        owner.token,
        "GET",
        `/api/v1/conversations/${createdBody.id}/messages?limit=10&cursor=${messageBody.nextCursor}`,
      ),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    const messageRestBody = (await messageRest.json()) as {
      messages: Array<{ content: string }>;
    };
    assert.deepEqual(
      messageRestBody.messages.map((message) => message.content),
      ["again"],
    );

    const hiddenMessages = await listMessagesRoute(
      authed(
        cookieName,
        other.token,
        "GET",
        `/api/v1/conversations/${createdBody.id}/messages`,
      ),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    assert.equal(hiddenMessages.status, 404);

    const ended = await endPost(
      authed(
        cookieName,
        owner.token,
        "POST",
        `/api/v1/conversations/${createdBody.id}/end`,
      ),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    const endedBody = (await ended.json()) as {
      conversation: { status: string; endedAt: string };
    };
    assert.equal(ended.status, 200);
    assert.equal(endedBody.conversation.status, "ended");
    assert.equal(typeof endedBody.conversation.endedAt, "string");

    const endedAgain = await endPost(
      authed(
        cookieName,
        owner.token,
        "POST",
        `/api/v1/conversations/${createdBody.id}/end`,
      ),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    const endedAgainBody = (await endedAgain.json()) as {
      conversation: { status: string; endedAt: string };
    };
    assert.equal(endedAgain.status, 200);
    assert.equal(endedAgainBody.conversation.status, "ended");
    assert.equal(
      endedAgainBody.conversation.endedAt,
      endedBody.conversation.endedAt,
    );

    const failed = await failConversationForUser(prisma, {
      userId: other.userId,
      conversationId: foreign.id,
      now: new Date("2026-10-10T13:00:00.000Z"),
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.endedAt?.toISOString(), "2026-10-10T13:00:00.000Z");
    const failedAgain = await endPost(
      authed(
        cookieName,
        other.token,
        "POST",
        `/api/v1/conversations/${foreign.id}/end`,
      ),
      { params: Promise.resolve({ id: foreign.id }) },
    );
    const failedAgainBody = (await failedAgain.json()) as {
      conversation: { status: string; endedAt: string };
    };
    assert.equal(failedAgain.status, 200);
    assert.equal(failedAgainBody.conversation.status, "failed");
    assert.equal(
      failedAgainBody.conversation.endedAt,
      "2026-10-10T13:00:00.000Z",
    );
    await assert.rejects(
      () =>
        failConversationForUser(prisma, {
          userId: owner.userId,
          conversationId: createdBody.id,
          now: new Date(),
        }),
      InvalidConversationTransition,
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
  const phone = `+1415555${String(randomInt(0, 10000)).padStart(4, "0")}`;
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

function sessionCookie(name: string, token: string): string {
  return `${name}=${token}`;
}

function authed(
  cookieName: string,
  token: string,
  method: string,
  pathname = "/api/v1/conversations",
): Request {
  return new Request(`http://127.0.0.1${pathname}`, {
    method,
    headers: { cookie: sessionCookie(cookieName, token) },
  });
}
