import "server-only";
import { getServerConfig } from "../config/env.ts";
import { assertServiceCredential } from "./service-auth.ts";
import {
  ApiError,
  apiErrorCodes,
  handleApiRequest,
} from "../shared/api-error.ts";
import { REQUEST_ID_HEADER } from "../shared/request-log.ts";
import {
  readJsonBody,
  readObject,
  readString,
  rejectInvalid,
  RequestValidationError,
} from "../shared/validate-request.ts";
import {
  fetchCurrentWeather,
  WeatherLocationError,
  WeatherNotFoundError,
  WeatherUnavailableError,
  type WeatherReport,
} from "./weather.ts";

export type WeatherHandlerDeps = {
  tokens: { current: string; previous: string | null };
  current: (location: string) => Promise<WeatherReport>;
};

export function handleWeatherRequest(
  request: Request,
  deps: WeatherHandlerDeps = defaultWeatherDeps(),
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertServiceCredential(request, deps.tokens);
    try {
      const body = readObject(await readJsonBody(request));
      if (!body.ok) {
        throw new RequestValidationError([body.issue]);
      }
      const location = readString(body.value.location, "location", {
        minLength: 1,
        maxLength: 80,
      });
      rejectInvalid([location]);
      if (!location.ok) {
        throw new RequestValidationError([
          { name: "body", message: "The request is invalid." },
        ]);
      }
      const report = await deps.current(location.value);
      return jsonData(report);
    } catch (error) {
      if (error instanceof WeatherLocationError) {
        throw new RequestValidationError([
          { name: "location", message: error.message },
        ]);
      }
      if (error instanceof WeatherNotFoundError) {
        throw new ApiError(404, apiErrorCodes.notFound, error.message);
      }
      if (error instanceof WeatherUnavailableError) {
        return unavailable(request);
      }
      throw error;
    }
  });
}

function defaultWeatherDeps(): WeatherHandlerDeps {
  const config = getServerConfig();
  return {
    tokens: {
      current: config.internalService.token,
      previous: config.internalService.previousToken,
    },
    current: (location) =>
      fetchCurrentWeather({
        baseUrl: config.weather.baseUrl,
        apiKey: config.weather.apiKey,
        location,
      }),
  };
}

function unavailable(request: Request): Response {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? "";
  return Response.json(
    {
      error: {
        code: "unavailable",
        message: "Weather is unavailable.",
        requestId,
      },
    },
    {
      status: 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

function jsonData(body: WeatherReport): Response {
  return Response.json(
    {
      location: body.location,
      condition: body.condition,
      temperatureC: body.temperatureC,
      humidityPercent: body.humidityPercent,
      observedAt: body.observedAt,
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
