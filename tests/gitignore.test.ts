import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

const ignoredPaths = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "node_modules/left-pad/index.js",
  ".next/server/app.js",
  "out/index.html",
  "build/index.js",
  "dist/index.js",
  "npm-debug.log",
  "logs/app.log",
  "secrets/server.pem",
  "private.key",
  "certs/server.p12",
  "certs/server.pfx",
  "src/generated/prisma/client.ts",
];

test("dependencies, builds, logs, and secret files are ignored", async () => {
  const { stdout } = await git(["check-ignore", "--", ...ignoredPaths]);
  assert.deepEqual(stdout.trim().split("\n"), ignoredPaths);
});

test(".env.example stays available to commit", async () => {
  await assert.rejects(git(["check-ignore", "-q", "--", ".env.example"]));
});

test("tracked files do not include secrets or generated output", async () => {
  const { stdout } = await git(["ls-files", "-z"]);
  const tracked = stdout.split("\0").filter((file) => file !== "");
  const blocked =
    /(?:^|\/)(?:\.env(?:\.|$)|node_modules|\.next|out|build|dist)(?:\/|$)|(?:^|\/)[^/]+\.(?:pem|key|p12|pfx|log)$/;

  assert.deepEqual(
    tracked.filter((file) => file !== ".env.example" && blocked.test(file)),
    [],
  );
});

function git(args: string[]): Promise<{ stdout: string }> {
  return execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
}
