import assert from "node:assert/strict";
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

const {
  fetchCurrentWeather,
  readWeatherQuery,
  WeatherLocationError,
  WeatherNotFoundError,
  WeatherUnavailableError,
} = await import("../src/server/integrations/weather.ts");
const { handleWeatherRequest } =
  await import("../src/server/weather/internal-http.ts");

const apiKey = "weather-key-should-stay-hidden";
const baseUrl = "https://api.weatherapi.com/v1";

test("a city or coordinates become one weather request on the provider host", async () => {
  const city = await captureRequest("Riyadh");
  assert.equal(city.origin, "https://api.weatherapi.com");
  assert.equal(city.pathname, "/v1/current.json");
  assert.equal(city.searchParams.get("q"), "Riyadh");
  assert.equal(city.searchParams.get("key"), apiKey);
  assert.equal(city.redirect, "error");

  const point = await captureRequest("24.7136, 46.6753");
  assert.equal(point.searchParams.get("q"), "24.7136,46.6753");

  const report = await fetchCurrentWeather({
    baseUrl,
    apiKey,
    location: "  الرياض  ",
    fetchImpl: async () => Response.json(sampleReport("الرياض", "SA")),
  });
  assert.deepEqual(report, {
    location: "الرياض, SA",
    condition: "clear sky",
    temperatureC: 32.2,
    humidityPercent: 12,
    observedAt: "2025-10-11T08:00:00.000Z",
  });
  assert.equal(JSON.stringify(report).includes(apiKey), false);
});

test("location text cannot choose a URL", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return Response.json(sampleReport("Riyadh", "SA"));
  };
  for (const location of [
    "https://evil.example/weather",
    "city?x=1",
    "user@host",
    "",
    "   ",
    "91, 0",
    "not a city 1",
  ]) {
    await assert.rejects(
      () => fetchCurrentWeather({ baseUrl, apiKey, location, fetchImpl }),
      WeatherLocationError,
    );
  }
  assert.equal(calls, 0);
  assert.deepEqual(readWeatherQuery("Riyadh, SA"), {
    kind: "city",
    name: "Riyadh, SA",
  });
});

test("unknown places and provider failures stay free of the API key", async () => {
  await assert.rejects(
    () =>
      fetchCurrentWeather({
        baseUrl,
        apiKey,
        location: "Nowhereville",
        fetchImpl: async () =>
          Response.json(
            { error: { code: 1006, message: `missing ${apiKey}` } },
            { status: 400 },
          ),
      }),
    (error: unknown) => {
      assert.ok(error instanceof WeatherNotFoundError);
      assert.equal(error.message.includes(apiKey), false);
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchCurrentWeather({
        baseUrl,
        apiKey,
        location: "Riyadh",
        fetchImpl: async () =>
          new Response(`bad gateway ${apiKey}`, { status: 502 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof WeatherUnavailableError);
      assert.equal(error.message.includes(apiKey), false);
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchCurrentWeather({
        baseUrl,
        apiKey,
        location: "Riyadh",
        fetchImpl: async () => {
          throw new Error(`timeout ${apiKey}`);
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof WeatherUnavailableError);
      assert.equal(error.message.includes(apiKey), false);
      return true;
    },
  );
});

test("the agent weather endpoint requires the service credential", async () => {
  const tokens = { current: "service-token-value", previous: null };
  let requested = "";
  const current = async (location: string) => {
    requested = location;
    return {
      location: "Riyadh, SA",
      condition: "clear sky",
      temperatureC: 32,
      humidityPercent: 10,
      observedAt: "2026-10-11T09:00:00.000Z",
    };
  };

  const missing = await handleWeatherRequest(
    weatherRequest(null, { location: "Riyadh" }),
    { tokens, current },
  );
  assert.equal(missing.status, 401);
  assert.equal(requested, "");

  const invalid = await handleWeatherRequest(
    weatherRequest("service-token-value", { location: "https://evil.example" }),
    { tokens, current },
  );
  const invalidBody = await invalid.text();
  assert.equal(invalid.status, 400);
  assert.equal(invalidBody.includes(apiKey), false);
  assert.equal(requested, "");

  const ok = await handleWeatherRequest(
    weatherRequest("service-token-value", { location: "Riyadh" }),
    { tokens, current },
  );
  const body = (await ok.json()) as Record<string, unknown>;
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(body).sort(), [
    "condition",
    "humidityPercent",
    "location",
    "observedAt",
    "temperatureC",
  ]);
  assert.equal(JSON.stringify(body).includes("service-token-value"), false);
  assert.equal(requested, "Riyadh");

  const down = await handleWeatherRequest(
    weatherRequest("service-token-value", { location: "Riyadh" }),
    {
      tokens,
      current: async () => {
        throw new WeatherUnavailableError();
      },
    },
  );
  const downBody = await down.text();
  assert.equal(down.status, 503);
  assert.match(downBody, /Weather is unavailable/);
  assert.equal(downBody.includes(apiKey), false);
});

async function captureRequest(
  location: string,
): Promise<URL & { redirect: string }> {
  let seen = "";
  let redirect = "";
  await fetchCurrentWeather({
    baseUrl,
    apiKey,
    location,
    fetchImpl: async (input, init) => {
      seen = String(input);
      redirect = String(init?.redirect ?? "");
      return Response.json(sampleReport("Riyadh", "SA"));
    },
  });
  const url = new URL(seen) as URL & { redirect: string };
  url.redirect = redirect;
  return url;
}

function sampleReport(name: string, country: string): unknown {
  return {
    location: { name, country },
    current: {
      temp_c: 32.15,
      humidity: 12,
      last_updated_epoch: 1_760_169_600,
      condition: { text: "clear sky" },
    },
  };
}

function weatherRequest(token: string | null, body: unknown): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request("http://127.0.0.1/api/internal/weather", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
