# Weather

The voice agent can ask for the current weather. The browser never calls the weather provider. The API key stays on the server.

## Provider

| Item | Choice |
|---|---|
| Provider | [OpenWeather Current Weather](https://openweathermap.org/current) |
| Base URL | `https://api.openweathermap.org` |
| API key | Required. Set `WEATHER_API_KEY`. |
| What we request | Current conditions only |
| Timeout | 5 seconds |
| Unknown place | The provider returns “not found” |

The free plan is rate-limited. OpenWeather’s own site lists the current limit. A typical free key allows about 60 calls per minute.

The adapter calls only this path on the configured host:

`/data/2.5/weather`

It does not fetch a URL from the agent. A place name or coordinates are query fields, not a web address.

## Replace the provider

`fetchOpenWeather` is the only function that knows the OpenWeather URL and the `appid` parameter. Another provider can replace that function. The agent endpoint still returns the same fields:

| Field | Meaning |
|---|---|
| `location` | Place name |
| `condition` | Short text, such as `clear sky` |
| `temperatureC` | Temperature in Celsius |
| `humidityPercent` | Humidity from 0 to 100 |
| `observedAt` | Observation time in UTC |

## Agent call

`POST /api/internal/weather`

Header: `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`

```json
{ "location": "Riyadh" }
```

Coordinates are also accepted: `"24.71,46.68"`.

The response does not include the API key or the provider URL.
