import { handleWeatherRequest } from "../../../../server/weather/internal-http.ts";

export function POST(request: Request): Promise<Response> {
  return handleWeatherRequest(request);
}
