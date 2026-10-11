import "server-only";
import { RateLimitError } from "../shared/api-error";

const PHONE_LIMIT = 5;
const IP_LIMIT = 20;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_BUCKETS = 10_000;

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitScope = "login" | "register";

export type AuthRateLimiter = {
  consume(
    scope: RateLimitScope,
    input: { ip: string | null; phone: string | null },
  ): void;
};

export function createAuthRateLimiter(options: {
  phoneLimit: number;
  ipLimit: number;
  windowMs: number;
  now?: () => number;
}): AuthRateLimiter {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;

  return {
    consume(scope, input) {
      const current = now();
      if (buckets.size > MAX_BUCKETS) {
        for (const [key, bucket] of buckets) {
          if (bucket.resetAt <= current) {
            buckets.delete(key);
          }
        }
      }

      const checks: Array<{ key: string; limit: number }> = [];
      if (input.ip !== null && input.ip.length > 0) {
        checks.push({
          key: `${scope}:ip:${input.ip}`,
          limit: options.ipLimit,
        });
      }
      if (input.phone !== null && input.phone.length > 0) {
        checks.push({
          key: `${scope}:phone:${input.phone}`,
          limit: options.phoneLimit,
        });
      }

      let blocked = false;
      let retryAfterSeconds = 0;
      for (const check of checks) {
        const bucket = touch(buckets, check.key, current, options.windowMs);
        if (bucket.count > check.limit) {
          blocked = true;
          retryAfterSeconds = Math.max(
            retryAfterSeconds,
            Math.ceil((bucket.resetAt - current) / 1000),
          );
        }
      }
      if (blocked) {
        throw new RateLimitError(Math.max(retryAfterSeconds, 1));
      }
    },
  };
}

export const authRateLimiter = createAuthRateLimiter({
  phoneLimit: PHONE_LIMIT,
  ipLimit: IP_LIMIT,
  windowMs: WINDOW_MS,
});

export function readClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (isIp(first)) {
      return first;
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim() ?? "";
  if (isIp(realIp)) {
    return realIp;
  }
  return null;
}

function touch(
  buckets: Map<string, Bucket>,
  key: string,
  current: number,
  windowMs: number,
): Bucket {
  const existing = buckets.get(key);
  if (existing === undefined || existing.resetAt <= current) {
    const created = { count: 1, resetAt: current + windowMs };
    buckets.set(key, created);
    return created;
  }
  existing.count += 1;
  return existing;
}

function isIp(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[0-9a-fA-F:.]+$/.test(value);
}
