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
  → POST /api/chat  (sends full message history as Anthropic.MessageParam[])
  → app/api/chat/route.ts
      → client.messages.stream() with claude-sonnet-4-6
      → Claude calls query_priority_erp tool
      → route.ts fetches Priority ERP OData API (Basic auth)
      → tool result fed back to Claude (up to 8 iterations)
      → SSE stream: { type: "token"|"status"|"done"|"error" }
  → Browser parses SSE, updates streaming message state
```

### Key files

- **`app/api/chat/route.ts`** — The entire backend. Defines the `queryPriorityERP` fetch helper, the `SYSTEM_PROMPT` with ERP entity/field documentation, the `query_priority_erp` tool schema, and the SSE streaming POST handler with agentic loop (max 8 iterations). Also contains the API call logger (`appendApiLog`, `extractUserQuestion`).
- **`app/api/logs/route.ts`** — `GET /api/logs` endpoint for reading the JSONL log. Supports `?entity=ORDERS`, `?status=error`, `?limit=N` query params. Returns entries newest-first plus aggregate stats.
- **`app/page.tsx`** — Single `"use client"` component (~900 lines). Contains all UI: `WelcomeScreen`, `MarkdownContent` (react-markdown + remark-gfm), `MessageBubble`, `StatusIndicator`, sidebar with `QUICK_QUERIES`, and the SSE parsing loop.
- **`app/globals.css`** — Imports Syne + JetBrains Mono from Google Fonts, defines the dark industrial theme via CSS variables, markdown table styles (`.markdown-body`), and scan-line animation.
- **`tailwind.config.ts`** — Custom color palette: `bg` (#06060F), `surface`, `border`, amber/emerald/rose/blue ERP accent colors. Font families: `font-sans` = Syne, `font-mono` = JetBrains Mono.
- **`next.config.mjs`** — Sets `dns.setDefaultResultOrder("ipv4first")` at module load time. This is critical — IPv6 is broken on the deployment network; without this fix all outbound HTTPS connections (Anthropic API + Priority ERP) fail with ECONNRESET.

### Priority ERP API

- **Base URL**: `https://aipriority.priorityweb.cloud/odata/priority/tabula.ini/moftov`
- **Auth**: HTTP Basic (`PRIORITY_USERNAME:PRIORITY_PASSWORD`)
- **Protocol**: OData v4 — standard `$filter`, `$select`, `$top`, `$orderby`, `$expand` params
- **`$top` is capped at 50** in `queryPriorityERP`
- Key entities: `CUSTOMERS`, `ORDERS`, `PART`, `SUPPLIERS`, `PORDERS`, `DOCUMENTS_D`
- Data is primarily Hebrew; `CUSTDES`/`PARTDES` = Hebrew name, `ECUSTDES` = English name
- Open orders: `BOOLCLOSED eq null`; closed: `BOOLCLOSED eq 'Y'`

### Environment variables (`.env.local`)

```
ANTHROPIC_API_KEY=...
PRIORITY_BASE_URL=...        # optional, has hardcoded fallback
PRIORITY_USERNAME=...        # optional, has hardcoded fallback
PRIORITY_PASSWORD=...        # optional, has hardcoded fallback
```

### SSE protocol (client ↔ route.ts)

| Event type | Payload | Purpose |
|---|---|---|
| `token` | `{ text: string }` | Streaming Claude text delta |
| `status` | `{ message: string }` | ERP query progress ("Querying ORDERS...") |
| `done` | — | Stream complete |
| `error` | `{ message: string }` | Error to display |

### API call log

Every Priority ERP query is appended as a JSON line to `logs/priority-api-calls.jsonl` (created on first use, gitignored). Each entry records:

```json
{
  "timestamp": "2026-03-03T10:45:12.034Z",
  "userQuestion": "מה הזמנות הפתוחות השבוע?",
  "entity": "ORDERS",
  "params": { "filter": "BOOLCLOSED eq null", "select": "...", "top": 20 },
  "status": "success",
  "recordCount": 14,
  "durationMs": 438
}
```

View via API while the dev server is running:

```
GET /api/logs                   # last 200 entries + stats
GET /api/logs?entity=ORDERS     # filter by entity
GET /api/logs?status=error      # filter by outcome
GET /api/logs?limit=50          # change page size
```

### Known issues / quirks

- `thinking: { type: "adaptive" }` is cast as `any` because the SDK TypeScript types haven't caught up with the API yet.
- **IPv6 broken on this network** — `next.config.mjs` applies `dns.setDefaultResultOrder("ipv4first")` globally. Never remove this line; without it all outbound TLS connections fail silently with ECONNRESET.
- The Priority ERP API uses `Asia/Jerusalem` timezone (UTC+2/+3) — date filters must include timezone offset, e.g. `2026-01-01T00:00:00+02:00`.
- The system prompt and UI are fully Hebrew / RTL. `app/layout.tsx` sets `<html lang="he" dir="rtl">`. Sidebar uses `borderLeft` (not `borderRight`) because RTL flex reverses child order.
