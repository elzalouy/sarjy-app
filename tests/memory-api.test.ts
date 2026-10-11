import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { registerHooks } from "node:module";
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

const { createPrismaClient } = await import("../src/server/database/prisma.ts");
const { DELETE, GET, PATCH, PUT } =
  await import("../src/app/api/internal/users/[userId]/memory/route.ts");

test("the agent can read and write only the requested user's memory", async (t) => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  if (
    databaseUrl === undefined ||
    databaseUrl.length === 0 ||
    serviceToken === undefined ||
    serviceToken.length === 0
  ) {
    t.skip("DATABASE_URL or INTERNAL_SERVICE_TOKEN is not set.");
    return;
  }

  const prisma = createPrismaClient(databaseUrl);
  const suffix = String(randomInt(0, 10000)).padStart(4, "0");
  const ownerPhone = `+1415559${suffix}`;
  const otherPhone = `+1415560${suffix}`;
  const secret = "super-secret-password";

  try {
    const owner = await prisma.user.create({
      data: {
        phoneNumber: ownerPhone,
        passwordHash: "stored-hash",
        status: "active",
      },
    });
    const other = await prisma.user.create({
      data: {
        phoneNumber: otherPhone,
        passwordHash: "stored-hash",
        status: "active",
      },
    });

    const missingAuth = await PUT(
      agentRequest(owner.id, "PUT", null, {
        key: "preferred_name",
        value: "Sara",
        source: "user",
        approved: true,
      }),
      routeContext(owner.id),
    );
    assert.equal(missingAuth.status, 401);
    assert.equal((await missingAuth.text()).includes(secret), false);
    assert.equal(await prisma.memory.count({ where: { userId: owner.id } }), 0);

    const badToken = await GET(
      agentRequest(owner.id, "GET", "not-the-service-token"),
      routeContext(owner.id),
    );
    assert.equal(badToken.status, 401);

    const cookieOnly = await GET(
      new Request(memoryUrl(owner.id), {
        headers: { cookie: "sarjy_session=user-session" },
      }),
      routeContext(owner.id),
    );
    assert.equal(cookieOnly.status, 401);

    const unknownUser = await GET(
      agentRequest("11111111-1111-4111-8111-111111111111", "GET", serviceToken),
      routeContext("11111111-1111-4111-8111-111111111111"),
    );
    assert.equal(unknownUser.status, 404);

    const badBody = await PUT(
      agentRequest(owner.id, "PUT", serviceToken, {
        key: "preferred_name",
        source: "user",
        approved: true,
      }),
      routeContext(owner.id),
    );
    assert.equal(badBody.status, 400);

    const disallowed = await PUT(
      agentRequest(owner.id, "PUT", serviceToken, {
        key: "password",
        value: secret,
        source: "user",
        approved: true,
      }),
      routeContext(owner.id),
    );
    const disallowedText = await disallowed.text();
    assert.equal(disallowed.status, 400);
    assert.equal(disallowedText.includes(secret), false);
    assert.equal(await prisma.memory.count({ where: { userId: owner.id } }), 0);

    const saved = await PUT(
      agentRequest(owner.id, "PUT", serviceToken, {
        key: "preferred_name",
        value: "Sara",
        source: "user",
        approved: false,
      }),
      routeContext(owner.id),
    );
    const savedBody = (await saved.json()) as {
      memory: { key: string; value: string };
    };
    assert.equal(saved.status, 200);
    assert.equal(savedBody.memory.value, "Sara");
    assert.equal(JSON.stringify(savedBody).includes(ownerPhone), false);
    assert.equal(JSON.stringify(savedBody).includes("stored-hash"), false);

    const ownerList = await GET(
      agentRequest(owner.id, "GET", serviceToken),
      routeContext(owner.id),
    );
    const ownerListBody = (await ownerList.json()) as {
      memories: Array<{ key: string; value: string }>;
    };
    assert.equal(ownerList.status, 200);
    assert.deepEqual(
      ownerListBody.memories.map((row) => row.value),
      ["Sara"],
    );

    const otherList = await GET(
      agentRequest(other.id, "GET", serviceToken),
      routeContext(other.id),
    );
    const otherListBody = (await otherList.json()) as {
      memories: Array<{ value: string }>;
    };
    assert.equal(otherList.status, 200);
    assert.deepEqual(otherListBody.memories, []);

    const otherWrite = await PUT(
      agentRequest(other.id, "PUT", serviceToken, {
        key: "preferred_name",
        value: "Noor",
        source: "user",
        approved: true,
      }),
      routeContext(other.id),
    );
    assert.equal(otherWrite.status, 200);
    const ownerAfterOtherWrite = await GET(
      agentRequest(owner.id, "GET", serviceToken),
      routeContext(owner.id),
    );
    const ownerAfterBody = (await ownerAfterOtherWrite.json()) as {
      memories: Array<{ value: string }>;
    };
    assert.deepEqual(
      ownerAfterBody.memories.map((row) => row.value),
      ["Sara"],
    );

    const missingCorrection = await PATCH(
      agentRequest(other.id, "PATCH", serviceToken, {
        key: "city",
        value: "Riyadh",
        source: "user",
        approved: true,
      }),
      routeContext(other.id),
    );
    assert.equal(missingCorrection.status, 404);

    const corrected = await PATCH(
      agentRequest(owner.id, "PATCH", serviceToken, {
        key: "preferred_name",
        value: "Lina",
        source: "user",
        approved: true,
      }),
      routeContext(owner.id),
    );
    const correctedBody = (await corrected.json()) as {
      memory: { value: string };
    };
    assert.equal(corrected.status, 200);
    assert.equal(correctedBody.memory.value, "Lina");

    const unapproved = await PUT(
      agentRequest(owner.id, "PUT", serviceToken, {
        key: "preferred_name",
        value: "Omar",
        source: "extracted",
        approved: false,
      }),
      routeContext(owner.id),
    );
    assert.equal(unapproved.status, 400);
    const stillLina = await GET(
      agentRequest(owner.id, "GET", serviceToken),
      routeContext(owner.id),
    );
    const stillLinaBody = (await stillLina.json()) as {
      memories: Array<{ value: string }>;
    };
    assert.deepEqual(
      stillLinaBody.memories.map((row) => row.value),
      ["Lina"],
    );

    const otherDelete = await DELETE(
      agentRequest(other.id, "DELETE", serviceToken, {
        key: "city",
        source: "user",
        approved: true,
      }),
      routeContext(other.id),
    );
    const otherDeleteBody = (await otherDelete.json()) as { deleted: boolean };
    assert.equal(otherDelete.status, 200);
    assert.equal(otherDeleteBody.deleted, false);

    const deleted = await DELETE(
      agentRequest(owner.id, "DELETE", serviceToken, {
        key: "preferred_name",
        source: "user",
        approved: true,
      }),
      routeContext(owner.id),
    );
    const deletedBody = (await deleted.json()) as { deleted: boolean };
    assert.equal(deleted.status, 200);
    assert.equal(deletedBody.deleted, true);
    const ownerEmpty = await GET(
      agentRequest(owner.id, "GET", serviceToken),
      routeContext(owner.id),
    );
    const ownerEmptyBody = (await ownerEmpty.json()) as {
      memories: unknown[];
    };
    assert.deepEqual(ownerEmptyBody.memories, []);
    const otherStill = await GET(
      agentRequest(other.id, "GET", serviceToken),
      routeContext(other.id),
    );
    const otherStillBody = (await otherStill.json()) as {
      memories: Array<{ value: string }>;
    };
    assert.deepEqual(
      otherStillBody.memories.map((row) => row.value),
      ["Noor"],
    );
  } finally {
    await prisma.user.deleteMany({
      where: { phoneNumber: { in: [ownerPhone, otherPhone] } },
    });
    await prisma.$disconnect();
  }
});

function memoryUrl(userId: string): string {
  return `http://127.0.0.1/api/internal/users/${userId}/memory`;
}

function routeContext(userId: string): { params: Promise<{ userId: string }> } {
  return { params: Promise.resolve({ userId }) };
}

function agentRequest(
  userId: string,
  method: string,
  token: string | null,
  body?: unknown,
): Request {
  const headers = new Headers();
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request(memoryUrl(userId), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
