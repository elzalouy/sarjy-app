import assert from "node:assert/strict";
import { test } from "node:test";
import nextConfig from "../next.config.ts";

test("next config loads with agent rules disabled", () => {
  assert.equal(typeof nextConfig, "object");
  assert.ok(nextConfig);
  assert.equal(nextConfig.agentRules, false);
});
