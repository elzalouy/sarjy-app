# Module boundaries

This file is the agreed code layout for the Next.js app. Keep new code inside these folders.

## Folders

| Folder | What belongs here |
|---|---|
| `src/app` | Pages and layouts. These files wire the UI together. |
| `src/app/api` | Route Handlers. They check input, call one use case, and return a response. |
| `src/components` | Shared UI used by more than one feature. Buttons, inputs, and layout pieces go here later. |
| `src/features/auth` | Auth screens and UI state. |
| `src/features/conversations` | Conversation screens and UI state. |
| `src/features/memory` | Memory screens and UI state. |
| `src/features/voice` | Call screen and browser voice UI. |
| `src/server/config` | Server environment settings. |
| `src/server/database` | Database reads and writes. |
| `src/server/auth` | Auth use cases, such as register and login. |
| `src/server/conversations` | Conversation use cases. |
| `src/server/memory` | Memory use cases. |
| `src/server/integrations` | Calls to outside systems, such as LiveKit and weather. |
| `src/server/shared` | Small server helpers used by more than one use case. |

`src/features` is UI. `src/server` is server-only. Voice has UI under `src/features/voice`. LiveKit calls stay in `src/server/integrations`.

## Dependency direction

Read each row as: code in the first folder may import the second folder. Any other import is not allowed.

| From | May import |
|---|---|
| `src/app` | `src/features`, `src/components`, and server use cases in `src/server/auth`, `src/server/conversations`, `src/server/memory`, `src/server/config`, `src/server/shared` |
| `src/features` | `src/components` only |
| `src/components` | nothing inside `src` |
| `src/server/auth`, `src/server/conversations`, `src/server/memory` | `src/server/database`, `src/server/integrations`, `src/server/config`, `src/server/shared` |
| `src/server/database`, `src/server/integrations` | `src/server/config`, `src/server/shared` |
| `src/server/shared` | `src/server/config` |
| `src/server/config` | nothing inside `src` |

## Rules

1. A Route Handler does not contain business rules and does not query the database. It calls a use case.
2. UI files render and send browser events. They do not copy business rules that already live in `src/server`.
3. A client component must not import `src/server`.
4. Every TypeScript file under `src/server` starts with `import "server-only"`.
5. One domain use case does not import another domain use case. Pass the needed ids in as arguments.
6. Do not add a framework layer, base classes, or a dependency-injection container for these folders.
