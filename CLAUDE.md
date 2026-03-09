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

This is a **Next.js 15 App Router** project with a single-page chat UI that queries a live Priority ERP system via Claude's tool-use agentic loop.

### Data flow

```
Browser (app/page.tsx)
  → POST /api/chat  (sends full message history as { role, content }[])
  → app/api/chat/route.ts
      → AzureOpenAI client.chat.completions.create({ stream: true })
      → Model calls query_priority_erp tool (OpenAI function calling)
      → route.ts fetches Priority ERP OData API (Basic auth)
      → tool result fed back as role:"tool" message (up to 8 iterations)
      → SSE stream: { type: "token"|"status"|"done"|"error" }
  → Browser parses SSE, updates streaming message state
```

### Key files

- **`lib/erp-schema.ts`** — Single source of truth for ERP knowledge. Exports `ERP_ENTITIES` (entity/field definitions injected into `SYSTEM_PROMPT` via `buildSchemaReference()`) and `ENTITY_ALIASES` (maps wrong/alternate entity names to correct ones for the fallback retry system). Edit this file to add entities or update field descriptions.
- **`app/api/chat/route.ts`** — The entire backend. Defines `buildErpUrl`/`queryPriorityERP` (with alias-fallback on 5xx) and `queryAllPages` (automatic multi-page fetch), the `SYSTEM_PROMPT` built from `buildSchemaReference()`, the `query_priority_erp` tool schema (supports `fetchAll`, `skip`), and the SSE streaming POST handler with agentic loop (max 8 iterations). Also contains the API call logger (`appendApiLog`, `extractUserQuestion`).
- **`app/api/logs/route.ts`** — `GET /api/logs` endpoint for reading the JSONL log. Supports `?entity=ORDERS`, `?status=error`, `?limit=N` query params. Returns entries newest-first plus aggregate stats.
- **`app/page.tsx`** — Single `"use client"` component. Contains all UI: `WelcomeScreen`, `ChartRenderer` (recharts bar/line/pie), `MarkdownContent` (react-markdown + remark-gfm + chart code block interception), `MessageBubble`, `StatusIndicator`, sidebar with `QUICK_QUERIES`, and the SSE parsing loop. Textarea auto-focuses after each response.
- **`app/globals.css`** — Imports Syne + JetBrains Mono from Google Fonts, defines the dark industrial theme via CSS variables, markdown table styles (`.markdown-body`), and scan-line animation.
- **`tailwind.config.ts`** — Custom color palette: `bg` (#06060F), `surface`, `border`, amber/emerald/rose/blue ERP accent colors. Font families: `font-sans` = Syne, `font-mono` = JetBrains Mono.
- **`next.config.mjs`** — Sets `dns.setDefaultResultOrder("ipv4first")` at module load time. This is critical — IPv6 is broken on the deployment network; without this fix all outbound HTTPS connections (Azure OpenAI + Priority ERP) fail with ECONNRESET.

### Priority ERP API

- **Base URL**: `https://aipriority.priorityweb.cloud/odata/priority/tabula.ini/moftov`
- **Auth**: HTTP Basic (`PRIORITY_USERNAME:PRIORITY_PASSWORD`)
- **Protocol**: OData v4 — standard `$filter`, `$select`, `$top`, `$orderby`, `$expand` params
- **`$top` is capped at 50** per page; use `fetchAll:true` in the tool call to auto-page all records via `queryAllPages()`
- Key entities: `CUSTOMERS`, `ORDERS`, `LOGPART` (products — **not** `PART`), `AGENTS` (sales reps), `SUPPLIERS`, `PORDERS`, `DOCUMENTS_D`, `INVOICES` (alias: `AINVOICES`), `ACCBAL`
- Full entity list: `GET /odata/priority/tabula.ini/moftov/` with Basic auth → JSON `{value:[{name,kind,url}]}`
- Data is primarily Hebrew; `CUSTDES`/`PARTDES` = Hebrew name, `ECUSTDES` = English name
- Open orders: `BOOLCLOSED ne 'Y'`; closed: `BOOLCLOSED eq 'Y'` — **never use null in filters** (causes 500)
- Active customers/items: `STATDES eq 'פעיל'` — **never** `INACTIVEFLAG eq null`
- Order status values (ORDSTATUSDES): `טיוטא` / `אושר מוקדנית` / `מאושר סוכן` / `מאושרת לבצוע` / `בוצעה` / `שולמה` / `מבוטלת`
- Postman collection reference: https://documenter.getpostman.com/view/30274649/2sB3QRmRt4

### AI backend — Azure OpenAI (Azure Foundry)

The app uses **Azure OpenAI** via the `openai` npm package (`AzureOpenAI` client). Tool calling uses OpenAI function-calling format (`type: "function"`). The agentic loop appends results as `role: "tool"` messages (not Anthropic `tool_result` blocks).

- **Endpoint**: `https://giatec-resource.cognitiveservices.azure.com`
- **Deployment**: configured via `AZURE_OPENAI_DEPLOYMENT` env var (currently `gpt-5.2`)
- **API version**: `2024-05-01-preview`
- System prompt is the first message in the array (`role: "system"`)

### Environment variables (`.env.local`)

```
AZURE_OPENAI_ENDPOINT=https://giatec-resource.cognitiveservices.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-5.2          # must match the Azure deployment name exactly
AZURE_OPENAI_API_VERSION=2024-05-01-preview
PRIORITY_BASE_URL=...        # optional, has hardcoded fallback
PRIORITY_USERNAME=...        # optional, has hardcoded fallback
PRIORITY_PASSWORD=...        # optional, has hardcoded fallback
```

### SSE protocol (client ↔ route.ts)

| Event type | Payload | Purpose |
|---|---|---|
| `token` | `{ text: string }` | Streaming model text delta |
| `status` | `{ message: string }` | ERP query progress ("Querying ORDERS...") |
| `done` | — | Stream complete |
| `error` | `{ message: string }` | Error to display |

### Entity alias / fallback retry

`queryPriorityERP` builds a candidate list `[requestedEntity, ...ENTITY_ALIASES[requestedEntity]]` and tries each in order. A **4xx** is thrown immediately (bad filter/field, not a table name issue). A **5xx** triggers a move to the next alias. The resolved entity name and failed alternatives are included in the log entry and sent to the model as a `[NOTE]` in the tool result.

To register a new alias, add an entry to `ENTITY_ALIASES` in `lib/erp-schema.ts`.

### API call log

Every Priority ERP query is appended as a JSON line to `logs/priority-api-calls.jsonl` (created on first use, gitignored). Each entry records:

```json
{
  "timestamp": "2026-03-04T10:45:12.034Z",
  "userQuestion": "מה הזמנות הפתוחות השבוע?",
  "entity": "ORDERS",
  "params": { "filter": "BOOLCLOSED ne 'Y'", "select": "...", "top": 20 },
  "status": "success",
  "recordCount": 14,
  "durationMs": 438,
  "resolvedEntity": "ORDERS",
  "alternativesTried": []
}
```

View via API while the dev server is running:

```
GET /api/logs                   # last 200 entries + stats
GET /api/logs?entity=ORDERS     # filter by entity
GET /api/logs?status=error      # filter by outcome
GET /api/logs?limit=50          # change page size
```

### Paging / full-dataset queries

The `query_priority_erp` tool exposes two pagination mechanisms:
- `fetchAll: true` — calls `queryAllPages()` which loops with `$skip=0,50,100...` until a page has < 50 records; use for "all orders", totals, full-list requests
- `skip: N` + `top: M` — manual pagination for the caller

### Chart rendering

The model outputs ` ```chart ` fenced code blocks containing JSON; `ChartRenderer` in `app/page.tsx` renders them with **recharts**.

Supported chart spec:
```json
{"type":"bar","title":"כותרת","labels":["א","ב"],"datasets":[{"label":"סדרה","data":[100,200],"color":"#F59E0B"}]}
```
- `type`: `"bar"` | `"line"` | `"pie"`
- `datasets[].color` is optional; defaults to theme palette
- Styled to match the dark industrial theme

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

- **IPv6 broken on this network** — `next.config.mjs` applies `dns.setDefaultResultOrder("ipv4first")` globally. Never remove this line; without it all outbound TLS connections (Azure OpenAI + Priority ERP) fail silently with ECONNRESET.
- The Priority ERP API uses `Asia/Jerusalem` timezone (UTC+2/+3) — date filters must include timezone offset, e.g. `2026-01-01T00:00:00+02:00`.
- The system prompt and UI are fully Hebrew / RTL. `app/layout.tsx` sets `<html lang="he" dir="rtl">`. Sidebar uses `borderLeft` (not `borderRight`) because RTL flex reverses child order.
- **Priority OData does not support null comparisons** — `X eq null` / `X ne null` in `$filter` causes 500 or 400 errors. Use `STATDES eq 'פעיל'` for active records and `BOOLCLOSED ne 'Y'` for open records.
