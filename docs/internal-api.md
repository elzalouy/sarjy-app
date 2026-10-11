# Internal agent API

These calls are for the Python agent. They are not for the browser.

Every call needs this header:

```text
Authorization: Bearer <INTERNAL_SERVICE_TOKEN>
```

The token is the value of `INTERNAL_SERVICE_TOKEN` in the server `.env`. Do not send it to the browser or put it in logs.

## Setup

```bash
export BASE_URL="http://127.0.0.1:3000"
export AGENT_TOKEN="replace-with-internal-service-token"
export USER_ID="11111111-1111-4111-8111-111111111111"
export CONVERSATION_ID="22222222-2222-4222-8222-222222222222"
export ROOM_NAME="room_example"
```

Use the real user id and conversation id from the call. `USER_ID` must be the owner of that conversation.

If you open the app at `http://192.168.1.15:3000`, set `BASE_URL` to that address.

## Errors

Failed calls return JSON:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "The service credential is invalid.",
    "requestId": "11111111-1111-4111-8111-111111111111"
  }
}
```

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | Body or field is invalid. `fields` lists each problem. |
| 401 | `unauthorized` | Missing or wrong bearer token. |
| 404 | `not_found` | User, conversation, or place was not found. A wrong owner also returns 404. |
| 409 | `conflict` | The conversation is not active. |
| 503 | `unavailable` | The weather provider failed. |

## 1. Authorize the voice session

Call this when the agent joins a room. The returned `userId` is the conversation owner. Do not trust a user id from anywhere else.

```bash
curl -sS -X POST "$BASE_URL/api/internal/voice-sessions/authorize" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "'"$CONVERSATION_ID"'",
    "roomName": "'"$ROOM_NAME"'"
  }'
```

Optional check. If `userId` is present and it is not the owner, the response is 404.

```bash
curl -sS -X POST "$BASE_URL/api/internal/voice-sessions/authorize" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "'"$CONVERSATION_ID"'",
    "roomName": "'"$ROOM_NAME"'",
    "userId": "'"$USER_ID"'"
  }'
```

`200` response:

```json
{
  "conversationId": "22222222-2222-4222-8222-222222222222",
  "userId": "11111111-1111-4111-8111-111111111111",
  "roomName": "room_example"
}
```

## 2. Save a transcript line

`role` is `user` or `assistant`. `content` is 1 to 8000 characters.

`eventId` is optional. Send the same `eventId` again and the server returns the first line. It does not store a second copy. The first save is `201`. A repeat is `200`.

`createdAt` is optional. Use an ISO time, such as `2026-10-11T09:00:00.000Z`.

```bash
curl -sS -X POST "$BASE_URL/api/internal/conversations/$CONVERSATION_ID/transcripts" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "'"$USER_ID"'",
    "role": "user",
    "content": "What is the weather in Riyadh?",
    "eventId": "lk-event-1",
    "createdAt": "2026-10-11T09:00:00.000Z"
  }'
```

`201` response:

```json
{
  "message": {
    "id": "33333333-3333-4333-8333-333333333333",
    "role": "user",
    "content": "What is the weather in Riyadh?",
    "createdAt": "2026-10-11T09:00:00.000Z"
  }
}
```

`userId` must be the conversation owner. Another user id returns 404 and stores nothing.

## 3. Read memory

Any key can be stored. A key is 1 to 64 characters. A value is 1 to 80 characters. Passwords, tokens, card numbers, email addresses, and phone numbers are rejected.

```bash
curl -sS -X GET "$BASE_URL/api/internal/users/$USER_ID/memory" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

`200` response:

```json
{
  "memories": [
    {
      "key": "preferred_name",
      "value": "Sara",
      "updatedAt": "2026-10-11T09:00:00.000Z"
    }
  ]
}
```

An unknown user id returns 404. Another user's list does not include this user's rows.

## 4. Store or replace memory

`source` is `user` or `extracted`.

- `user` can be stored immediately. `approved` may be `false`.
- `extracted` is stored only when `approved` is `true`.

A later write for the same key replaces the whole value.

```bash
curl -sS -X PUT "$BASE_URL/api/internal/users/$USER_ID/memory" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "preferred_name",
    "value": "Sara",
    "source": "user",
    "approved": false
  }'
```

`200` response:

```json
{
  "memory": {
    "key": "preferred_name",
    "value": "Sara",
    "updatedAt": "2026-10-11T09:00:00.000Z"
  }
}
```

## 5. Correct an existing memory

This replaces a key that already exists. It does not create a new key. A missing key returns 404.

```bash
curl -sS -X PATCH "$BASE_URL/api/internal/users/$USER_ID/memory" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "preferred_name",
    "value": "Noor",
    "source": "user",
    "approved": true
  }'
```

The response shape is the same as store.

## 6. Delete one memory

```bash
curl -sS -X DELETE "$BASE_URL/api/internal/users/$USER_ID/memory" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "preferred_name",
    "source": "user",
    "approved": true
  }'
```

`200` response:

```json
{ "deleted": true }
```

`deleted` is `false` when that user does not have the key. An unapproved `extracted` delete is rejected and does not remove the row.

## 7. Current weather

`location` is a city name or `latitude,longitude`. It must not be a web address.

```bash
curl -sS -X POST "$BASE_URL/api/internal/weather" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "location": "Riyadh"
  }'
```

Coordinates:

```bash
curl -sS -X POST "$BASE_URL/api/internal/weather" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "location": "24.71,46.68"
  }'
```

`200` response:

```json
{
  "location": "Riyadh, SA",
  "condition": "clear sky",
  "temperatureC": 32.1,
  "humidityPercent": 12,
  "observedAt": "2026-10-11T09:00:00.000Z"
}
```

An unknown place is 404. A provider failure is 503. The body never includes the weather API key.

## Python

Use the same header and JSON bodies as the curls.

```python
import os
import requests

base_url = os.environ["BASE_URL"]
headers = {
    "Authorization": f"Bearer {os.environ['AGENT_TOKEN']}",
    "Content-Type": "application/json",
}

response = requests.post(
    f"{base_url}/api/internal/weather",
    headers=headers,
    json={"location": "Riyadh"},
    timeout=10,
)
response.raise_for_status()
print(response.json())
```

Read `response.status_code` and `response.json()["error"]` when the call fails. Do not log `AGENT_TOKEN`.
