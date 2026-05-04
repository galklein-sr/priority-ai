# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Type-check and build for production
npm run start    # Run production build
```

No test runner or linter is configured.

## Architecture

Next.js 15 App Router — single-page chat UI that queries Priority ERP via an AI agentic loop, with an optional Microsoft Fabric analytical layer.

### Data flow

```
Browser (app/page.tsx)
  → POST /api/chat  (sends trimmed message history as { role, content }[])
  → app/api/chat/route.ts
      → AzureOpenAI streaming (gpt-5.2 via Azure Foundry)
      → Model calls query_priority_erp OR query_fabric_agent (up to 8 iterations)
      → query_priority_erp: fetches Priority ERP OData API (Basic auth)
      → query_fabric_agent: calls Microsoft Fabric Data Agent REST API
      → SSE stream: { type: "token"|"status"|"done"|"error" }
  → Browser parses SSE, updates streaming message state

Browser (sidebar sync button)
  → POST /api/fabric/sync  (streams NDJSON progress)
  → app/api/fabric/sync/route.ts
      → lib/fabric-sync.ts: queryAllPages() → Fabric SQL Warehouse bulk INSERT
```

### Key files

- **`lib/erp-schema.ts`** — Single source of truth for ERP knowledge. Exports `ERP_ENTITIES` (entity/field definitions injected into `SYSTEM_PROMPT` via `buildSchemaReference()`) and `ENTITY_ALIASES` (fallback retry map). Edit here to add entities or fields.
- **`lib/erp-client.ts`** — ERP query layer: `buildErpUrl`, `queryPriorityERP` (with alias-fallback on 5xx), `queryAllPages` (auto-pagination), plus `PRIORITY_BASE_URL`, `PRIORITY_CREDS`, `PAGE_SIZE=200`. Imported by both the chat route and the Fabric sync.
- **`app/api/chat/route.ts`** — Full backend: `SYSTEM_PROMPT`, two tool schemas (`query_priority_erp` and `query_fabric_agent`), SSE streaming POST handler with agentic loop (max 8 iterations), history trimming (`MAX_HISTORY_MESSAGES=10`), tool result truncation (`MAX_TOOL_RESULT_CHARS=80000`), and API call logger.
- **`lib/fabric-client.ts`** — Azure AD token cache (60-second pre-expiry refresh), `mssql` connection pool (globalThis-guarded for HMR), `executeSql()`, `queryFabricAgent()` REST call.
- **`lib/fabric-schema.ts`** — DDL generator. Reads `ERP_ENTITIES` and outputs `CREATE TABLE` SQL for all 12 tables. `ENTITY_PRIMARY_KEYS` maps each entity to its PK column(s). Dates stored as `NVARCHAR(50)` (Priority returns ISO strings with `+02:00` offsets).
- **`lib/fabric-sync.ts`** — Sync orchestrator: creates tables, fetches all ERP pages via `queryAllPages()`, TRUNCATE + bulk INSERT in batches of 100 rows. Sync state persisted to `data/fabric-sync-state.json`.
- **`app/api/fabric/sync/route.ts`** — `GET` returns sync state JSON. `POST` triggers sync (body: `{ entity?: string }`), streams NDJSON progress lines.
- **`app/api/logs/route.ts`** — `GET /api/logs` for reading `logs/priority-api-calls.jsonl`. Supports `?entity=`, `?status=`, `?limit=` params.
- **`app/page.tsx`** — Single `"use client"` component: `WelcomeScreen`, `ChartRenderer` (recharts), `MarkdownContent` (react-markdown + chart block interception), `MessageBubble`, sidebar with `QUICK_QUERIES` + Fabric Sync section (button, timestamps, progress log).
- **`next.config.mjs`** — Sets `dns.setDefaultResultOrder("ipv4first")` at module load. **Critical** — IPv6 broken on this network; removing this breaks all outbound HTTPS.

### Priority ERP API

- **Base URL**: `https://aipriority.priorityweb.cloud/odata/priority/tabula.ini/otttt`
- **Auth**: HTTP Basic (`PRIORITY_USERNAME:PRIORITY_PASSWORD`)
- **Protocol**: OData v4 — `$filter`, `$select`, `$top`, `$orderby`, `$expand`
- **`$top` capped at 200** per page; `queryAllPages()` loops with `$skip` until a page returns fewer than 200 records
- **Accessible entities**: `CUSTOMERS`, `ORDERS`, `LOGPART`, `AGENTS`, `AINVOICES`, `ACCBAL`, `DOCUMENTS_D`, `DOCUMENTS_N`, `PARTBAL`, `WAREHOUSES`, `PRICELIST`, `SERIAL`
- **NOT accessible** in `otttt`: `SUPPLIERS`, `PORDERS` — do not attempt
- Data is primarily Hebrew; `CUSTDES`/`PARTDES` = Hebrew name, `ECUSTDES` = English name
- Open orders: `BOOLCLOSED ne 'Y'`; active customers/items: `STATDES eq 'פעיל'`
- **Never use null in filters** — `X eq null` / `X ne null` causes 500 crashes
- Order status values (ORDSTATUSDES): `טיוטא` / `אושר מוקדנית` / `מאושר סוכן` / `מאושרת לבצוע` / `בוצעה` / `שולמה` / `מבוטלת`
- Timezone: `Asia/Jerusalem` (UTC+2/+3) — date filters must include offset, e.g. `2026-01-01T00:00:00+02:00`

### AI backend — Azure OpenAI

Uses `openai` npm package (`AzureOpenAI` client). Tool calling uses OpenAI function-calling format. Tool results are `role: "tool"` messages (not Anthropic blocks).

- **Endpoint**: `https://giatec-resource.cognitiveservices.azure.com`
- **Deployment**: `AZURE_OPENAI_DEPLOYMENT` env var (currently `gpt-5.2`)
- Token limit guard: history trimmed to last 10 messages; tool results truncated at 80,000 chars

### Microsoft Fabric integration

An optional analytical layer — a pre-synced copy of ERP data in a Fabric SQL Warehouse, queried via the Fabric Data Agent REST API.

- **Authentication**: Azure AD service principal (`client_credentials` grant)
  - SQL scope: `https://database.windows.net/.default`
  - API scope: `https://api.fabric.microsoft.com/.default`
- **Data Agent endpoint**: `POST https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/dataAgents/{AGENT_ID}/messages`
- **Sync strategy**: full refresh per entity (TRUNCATE + bulk INSERT in batches of 100)
- Sync state in `data/fabric-sync-state.json` (gitignored)
- Model routing: `query_fabric_agent` for aggregations/analytics, `query_priority_erp` for real-time lookups

### Environment variables (`.env.local`)

```
AZURE_OPENAI_ENDPOINT=https://giatec-resource.cognitiveservices.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-5.2          # must match Azure deployment name exactly
AZURE_OPENAI_API_VERSION=2024-05-01-preview
PRIORITY_BASE_URL=...                    # optional, has hardcoded fallback
PRIORITY_USERNAME=...                    # optional, has hardcoded fallback
PRIORITY_PASSWORD=...                    # optional, has hardcoded fallback

# Microsoft Fabric (all required for Fabric features)
FABRIC_TENANT_ID=
FABRIC_CLIENT_ID=
FABRIC_CLIENT_SECRET=
FABRIC_WORKSPACE_ID=
FABRIC_SQL_ENDPOINT=        # {workspaceId}.datawarehouse.fabric.microsoft.com
FABRIC_DATABASE_NAME=
FABRIC_DATA_AGENT_ID=
```

When Fabric env vars are absent, `query_fabric_agent` short-circuits with an error and the model falls back to `query_priority_erp`.

### SSE protocol (client ↔ route.ts)

| Event type | Payload | Purpose |
|---|---|---|
| `token` | `{ text: string }` | Streaming model text delta |
| `status` | `{ message: string }` | Query progress ("Querying ORDERS...", "Fabric Agent responded") |
| `done` | — | Stream complete |
| `error` | `{ message: string }` | Error to display |

### Entity alias / fallback retry

`queryPriorityERP` (in `lib/erp-client.ts`) builds a candidate list `[requestedEntity, ...ENTITY_ALIASES[entity]]` and tries each in order. **4xx** = thrown immediately (bad filter/field). **5xx** = tries next alias. To add an alias: edit `ENTITY_ALIASES` in `lib/erp-schema.ts`.

### Chart rendering

Model outputs ` ```chart ` fenced blocks with JSON; `ChartRenderer` renders via recharts.

```json
{"type":"bar","title":"כותרת","labels":["א","ב"],"datasets":[{"label":"סדרה","data":[100,200],"color":"#F59E0B"}]}
```
Supported types: `"bar"` | `"line"` | `"pie"`. `color` is optional.

### Known field name corrections (confirmed against live API)

| Entity | Wrong field | Correct field |
|---|---|---|
| LOGPART | `PARTTYPEDES` | `ZANA_PARTTYPEDES` |
| LOGPART | `PRICELISTD` | `BASEPLPRICE` |
| LOGPART | `UOMDES` | `UNITNAME` |
| LOGPART | `FAMILY` | `FAMILYNAME` |
| LOGPART | `WARNQUANT` | *(does not exist — remove)* |
| CUSTOMERS | `AGENTDES` | *(does not exist — use `AGENTNAME`)* |
| CUSTOMERS | `CITY` | *(does not exist — use `ADDRESS`)* |
| AGENTS | `AGENTDES` | *(does not exist — `AGENTNAME` is both code and display name)* |

### Known issues / quirks

- **IPv6 broken on this network** — `dns.setDefaultResultOrder("ipv4first")` in `next.config.mjs` covers all outbound HTTPS (Azure OpenAI, Priority ERP, Fabric API, Azure AD token endpoint). Never remove.
- The system prompt and UI are fully Hebrew / RTL. `app/layout.tsx` sets `<html lang="he" dir="rtl">`. Sidebar uses `borderLeft` (not `borderRight`) because RTL flex reverses child order.
- `mssql` connection pool is stored on `globalThis._fabricPoolEntry` to survive Next.js HMR restarts in dev mode without leaking connections.
- Full sync of all 12 entities may take several minutes — `app/api/fabric/sync/route.ts` exports `maxDuration = 300` for Vercel Pro / self-hosted.
