import { AzureOpenAI } from "openai";
import type OpenAI from "openai";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { buildSchemaReference, ENTITY_ALIASES } from "@/lib/erp-schema";

// ─── API Call Logger ────────────────────────────────────────────────────────
const LOG_FILE = path.join(process.cwd(), "logs", "priority-api-calls.jsonl");

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface ApiLogEntry {
  timestamp: string;
  userQuestion: string;
  entity: string;
  params: {
    filter?: string;
    select?: string;
    top?: number;
    orderby?: string;
    expand?: string;
  };
  status: "success" | "error" | "warning";
  recordCount?: number;
  errorMessage?: string;
  warningMessage?: string;
  durationMs: number;
  resolvedEntity?: string;
  alternativesTried?: string[];
  missingFields?: string[];
}

function appendApiLog(entry: ApiLogEntry) {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Non-fatal — logging failure must not break the API
  }
}

type SimpleMessage = { role: "user" | "assistant"; content: string };

function extractUserQuestion(messages: SimpleMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") return msg.content.trim();
  }
  return "unknown";
}
// ────────────────────────────────────────────────────────────────────────────

const client = new AzureOpenAI({
  endpoint:
    process.env.AZURE_OPENAI_ENDPOINT ||
    "https://giatec-resource.cognitiveservices.azure.com",
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  apiVersion:
    process.env.AZURE_OPENAI_API_VERSION || "2024-05-01-preview",
  deployment:
    process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.2-chat",
});

const PRIORITY_BASE_URL =
  process.env.PRIORITY_BASE_URL ||
  "https://aipriority.priorityweb.cloud/odata/priority/tabula.ini/moftov";

const PRIORITY_CREDS = Buffer.from(
  `${process.env.PRIORITY_USERNAME || "6AAE9884207242A0B371BE5C7B5DB639"}:${process.env.PRIORITY_PASSWORD || "PAT"}`
).toString("base64");

interface QueryResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  resolvedEntity: string;
  alternativesTried: string[];
}

type QueryParams = {
  entity: string;
  filter?: string;
  select?: string;
  top?: number;
  skip?: number;
  orderby?: string;
  expand?: string;
  fetchAll?: boolean;
};

function buildErpUrl(entity: string, params: QueryParams): string {
  const url = new URL(`${PRIORITY_BASE_URL}/${entity}`);
  if (params.filter) url.searchParams.set("$filter", params.filter);
  if (params.select) url.searchParams.set("$select", params.select);
  url.searchParams.set("$top", String(Math.min(Math.max(params.top ?? 20, 1), 50)));
  if (params.skip && params.skip > 0) url.searchParams.set("$skip", String(params.skip));
  if (params.orderby) url.searchParams.set("$orderby", params.orderby);
  if (params.expand) url.searchParams.set("$expand", params.expand);
  return url.toString();
}

const PAGE_SIZE = 50;

async function queryAllPages(
  params: QueryParams,
  onStatus: (message: string) => void,
  onAlternative?: (failedEntity: string, nextEntity: string, errorMsg: string) => void
): Promise<QueryResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRecords: any[] = [];
  let skipOffset = 0;
  let lastResult: QueryResult | null = null;

  while (true) {
    const pageParams = { ...params, top: PAGE_SIZE, skip: skipOffset, fetchAll: undefined };
    lastResult = await queryPriorityERP(pageParams, onAlternative);
    const pageRecords = Array.isArray(lastResult.data?.value) ? lastResult.data.value : [];
    allRecords.push(...pageRecords);
    if (pageRecords.length < PAGE_SIZE) break;
    skipOffset += PAGE_SIZE;
    onStatus(`${params.entity}: טעינת ${allRecords.length} רשומות...`);
  }

  return {
    data: { ...(lastResult?.data ?? {}), value: allRecords },
    resolvedEntity: lastResult?.resolvedEntity ?? params.entity,
    alternativesTried: lastResult?.alternativesTried ?? [],
  };
}

async function queryPriorityERP(
  params: QueryParams,
  onAlternative?: (failedEntity: string, nextEntity: string, errorMsg: string) => void
): Promise<QueryResult> {
  // Build candidate list: requested entity first, then any registered aliases.
  // Key lookup is upper-cased so AI output casing doesn't matter.
  const aliases = ENTITY_ALIASES[params.entity.toUpperCase()] ?? [];
  const candidates = [params.entity, ...aliases];

  let lastError: Error = new Error("Unknown error");
  const tried: string[] = [];

  for (const entityName of candidates) {
    const res = await fetch(buildErpUrl(entityName, params), {
      headers: {
        Authorization: `Basic ${PRIORITY_CREDS}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.ok) {
      return { data: await res.json(), resolvedEntity: entityName, alternativesTried: tried };
    }

    const body = await res.text().catch(() => "");
    const errMsg = `Priority API ${res.status} (${entityName}): ${body.slice(0, 300) || res.statusText}`;

    // 4xx = bad request / auth issue — no point trying aliases
    if (res.status < 500) throw new Error(errMsg);

    // 5xx = server/entity error — try next alias
    lastError = new Error(errMsg);
    tried.push(entityName);

    const nextIdx = candidates.indexOf(entityName) + 1;
    if (nextIdx < candidates.length) {
      onAlternative?.(entityName, candidates[nextIdx], errMsg);
    }
  }

  throw lastError;
}

const SYSTEM_PROMPT = `אתה עוזר עסקי חכם המחובר למערכת Priority ERP — מערכת תכנון משאבי ארגון מובילה המשמשת חברת הפצת מזון/עופות ישראלית.

**חשוב: ענה תמיד בעברית בלבד.** גם אם המשתמש שואל באנגלית, יש להשיב בעברית.

יש לך גישה בזמן אמת למסד הנתונים של Priority ERP. כאשר משתמשים שואלים שאלות על נתונים עסקיים, השתמש בכלי query_priority_erp לאחזור מידע עדכני.

**COMPANY CONTEXT:**
- Israeli food distribution company (poultry/processed foods)
- Main currency: ILS (Israeli Shekel), some export orders in USD
- Operating timezone: Asia/Jerusalem (UTC+2/+3)
- Customers and products may have Hebrew names (CUSTDES, PARTDES fields)
- Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}

**כיצד להשיב:**
1. תמיד שאל את ה-ERP תחילה לשאלות נתונים — אל תנחש
2. הצג נתונים בטבלאות markdown מעוצבות היטב עם כותרות ברורות
3. לאחר הטבלאות, ספק סיכום קצר עם תובנות מרכזיות (סכומים, ספירות, פריטים בולטים)
4. טקסט עברי תקין להצגה — המשתמשים יכולים לקרוא אותו
5. עצב מטבע עם סמל ₪/$ ו-2 ספרות עשרוניות
6. עצב תאריכים בפורמט DD/MM/YYYY לקריאות
7. לסט תוצאות גדול, הדגש את הרשומות החשובות ביותר
8. אם שאילתה לא מחזירה תוצאות, אמור זאת בבירור והצע סיבה אפשרית
9. ענה תמיד בעברית — זו שפת הממשק של המשתמש

**PAGING — WHEN TO USE fetchAll vs top+orderby:**
- The API returns max 50 records per call.
- **PREFER top+orderby+filter** for the vast majority of queries. If you can answer the question with filtering and sorting, always do so:
  - "Top 10 customers by revenue" → orderby="TOTPRICE desc", top:10 (NOT fetchAll)
  - "Best selling products" → orderby="QUANT desc", top:20 (NOT fetchAll)
  - "Latest 5 orders" → orderby="CURDATE desc", top:5 (NOT fetchAll)
  - "Most expensive products" → orderby="BASEPLPRICE desc", top:20 (NOT fetchAll)
  - "Newest customers" → orderby="CUSTNAME desc", top:20 (NOT fetchAll)
- **Use fetchAll:true ONLY when** the user explicitly asks for ALL records, a complete count/list, or when you must aggregate across the entire dataset (e.g. "how many customers do we have in total?", "list all open orders", "sum of all sales this year"). fetchAll fetches every record and is slow — avoid it whenever top+orderby suffices.

**CHARTS & GRAPHS:**
When the user asks for a chart, graph, diagram, or visual representation, output a fenced code block with language "chart" containing JSON. The UI will render it automatically.

Format:
\`\`\`chart
{"type":"bar","title":"כותרת הגרף","labels":["ינואר","פברואר","מרץ"],"datasets":[{"label":"הכנסות ₪","data":[120000,150000,80000]}]}
\`\`\`

- type: "bar" | "line" | "pie"
- labels: array of category/axis labels
- datasets: array of {label, data[], color?} — color is optional hex
- For pie charts, use one dataset only; data values are the slice sizes
- For multiple series (e.g. comparing two years), add multiple objects in datasets
- Always include a descriptive title in Hebrew
- Output the chart block AFTER any summary text, not before

**ENTITY DISAMBIGUATION — CRITICAL:**
- "סוכן" / "סוכנים" / "agent" / "agents" / "sales rep" / "salesperson" → use entity **AGENTS**
- "הזמנות" / "orders" / sales orders → use entity **ORDERS** (sales orders from customers)
- "הזמנות רכש" / "purchase orders" / orders to suppliers → use entity **PORDERS** (purchase orders to suppliers)
- Never confuse these two. ORDERS = selling TO customers. PORDERS = buying FROM suppliers.

**ODATA QUERY PATTERNS:**
⚠️ NEVER use null in any filter expression — Priority OData does not support null comparisons and will crash or return errors.
- Open orders: filter="BOOLCLOSED ne 'Y'"
- Closed orders: filter="BOOLCLOSED eq 'Y'"
- Order by status: filter="ORDSTATUSDES eq 'מאושרת לבצוע'"  (values: טיוטא / אושר מוקדנית / מאושר סוכן / מאושרת לבצוע / בוצעה / שולמה / מבוטלת)
- Date range: filter="CURDATE ge 2026-01-01T00:00:00+02:00 and CURDATE le 2026-12-31T00:00:00+02:00"
- Active customers: filter="STATDES eq 'פעיל'"
- Contains search: filter="contains(CUSTDES,'term')"
- Specific order: filter="ORDNAME eq 'SO2600001'"
- Multiple conditions: filter="BOOLCLOSED ne 'Y' and CURDATE ge 2026-01-01T00:00:00+02:00"
- Sort newest first: orderby="CURDATE desc"
- Specific customer's orders: filter="CUSTNAME eq '400204'"

**ENTITY & FIELD REFERENCE:**
${buildSchemaReference()}
`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "query_priority_erp",
      description:
        "Query the Priority ERP system for live business data. Use this for any question about customers, sales orders, products, suppliers, purchase orders, or other business entities. Always use this tool rather than guessing.",
      parameters: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            description:
              "The entity/table to query. Options: CUSTOMERS, ORDERS (sales orders from customers), LOGPART (products), AGENTS (sales reps), SUPPLIERS, PORDERS (purchase orders to suppliers), DOCUMENTS_D (delivery notes), ACCBAL (account balances), INVOICES. IMPORTANT: use ORDERS for sales orders, PORDERS for purchase orders — never swap them.",
          },
          filter: {
            type: "string",
            description:
              "OData $filter expression. Examples: \"BOOLCLOSED ne 'Y'\" or \"CURDATE ge 2026-01-01T00:00:00+02:00\" or \"CUSTNAME eq '400204'\" or \"contains(CUSTDES,'term')\". NEVER use null comparisons.",
          },
          select: {
            type: "string",
            description:
              "Comma-separated field names to return (improves performance). Example: \"ORDNAME,CUSTNAME,CDES,CURDATE,TOTPRICE,CODE,ORDSTATUSDES\"",
          },
          top: {
            type: "number",
            description:
              "Maximum number of records to return (1-50). Defaults to 20. Ignored when fetchAll is true.",
          },
          skip: {
            type: "number",
            description:
              "Number of records to skip for manual pagination (OData $skip). Use with top for manual paging. Prefer fetchAll:true for automatic full-dataset retrieval.",
          },
          fetchAll: {
            type: "boolean",
            description:
              "When true, automatically pages through ALL records (ignores top, uses $skip internally). Use ONLY when the user explicitly needs every record (e.g. full list, total count across all data, complete aggregation). For ranked or limited queries ('top 10 customers', 'best selling products', 'latest orders'), ALWAYS use orderby+top instead — it is much faster.",
          },
          orderby: {
            type: "string",
            description:
              "Sort expression. Examples: \"CURDATE desc\" or \"CUSTDES asc\" or \"TOTPRICE desc\"",
          },
          expand: {
            type: "string",
            description:
              "Related entities to expand/include (OData $expand). Example: \"ORDERITEMS_SUBFORM\"",
          },
        },
        required: ["entity"],
        additionalProperties: false,
      },
    },
  },
];

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as { messages: SimpleMessage[] };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Controller may be closed
        }
      };

      try {
        // Build conversation: system prompt first, then user/assistant history
        const allMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
          [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ];

        let iterations = 0;
        const MAX_ITERATIONS = 8;

        while (iterations < MAX_ITERATIONS) {
          iterations++;

          // Stream the response from Azure OpenAI
          // model must match the deployment name (AzureOpenAI still requires it)
          const openaiStream = await client.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.2-chat",
            stream: true,
            messages: allMessages,
            tools,
            tool_choice: "auto",
          });

          // Accumulate streamed content and tool call deltas
          let contentText = "";
          let finishReason: string | null = null;
          const tcMap: Record<
            number,
            { id: string; name: string; arguments: string }
          > = {};

          for await (const chunk of openaiStream) {
            const choice = chunk.choices[0];
            if (!choice) continue;

            finishReason = choice.finish_reason ?? finishReason;
            const delta = choice.delta;

            // Forward text tokens to client in real-time
            if (delta?.content) {
              contentText += delta.content;
              send({ type: "token", text: delta.content });
            }

            // Accumulate tool call deltas (name + arguments arrive in pieces)
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!tcMap[tc.index]) {
                  tcMap[tc.index] = { id: "", name: "", arguments: "" };
                }
                if (tc.id) tcMap[tc.index].id = tc.id;
                if (tc.function?.name) tcMap[tc.index].name += tc.function.name;
                if (tc.function?.arguments)
                  tcMap[tc.index].arguments += tc.function.arguments;
              }
            }
          }

          // Reconstruct full tool call objects — use a local type to avoid SDK union ambiguity
          type FunctionToolCall = {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          };
          const toolCalls: FunctionToolCall[] = Object.values(tcMap).map(
            (tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })
          );

          // Append assistant turn to conversation history
          allMessages.push({
            role: "assistant",
            content: contentText || null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls as any } : {}),
          });

          // No tool calls → conversation complete
          if (finishReason !== "tool_calls" || toolCalls.length === 0) break;

          // Execute each tool call and append results as tool messages
          for (const toolCall of toolCalls) {
            const input = JSON.parse(toolCall.function.arguments) as {
              entity: string;
              filter?: string;
              select?: string;
              top?: number;
              skip?: number;
              orderby?: string;
              expand?: string;
              fetchAll?: boolean;
            };

            const entityLabel = input.filter
              ? `${input.entity} (filtered)`
              : input.entity;

            send({ type: "status", message: `Querying ${entityLabel}...` });

            const callStart = Date.now();
            const logBase = {
              timestamp: new Date().toISOString(),
              userQuestion: extractUserQuestion(messages),
              entity: input.entity,
              params: {
                filter: input.filter,
                select: input.select,
                top: input.top,
                orderby: input.orderby,
                expand: input.expand,
              },
            };

            try {
              const onAlternative = (failedEntity: string, nextEntity: string, errMsg: string) => {
                send({ type: "status", message: `"${failedEntity}" → 5xx, trying "${nextEntity}" instead` });
                appendApiLog({ ...logBase, status: "error", errorMessage: `[fallback] ${errMsg} → trying ${nextEntity}`, durationMs: Date.now() - callStart, resolvedEntity: failedEntity, alternativesTried: [] });
              };

              const { data, resolvedEntity, alternativesTried } = input.fetchAll
                ? await queryAllPages(input, (msg) => send({ type: "status", message: msg }), onAlternative)
                : await queryPriorityERP(input, onAlternative);

              const records: unknown[] = Array.isArray(data?.value)
                ? data.value
                : [];
              const count = records.length;

              // ── Detect schema fields missing from actual API response ──────
              const missingFields: string[] = [];
              if (input.select && count > 0) {
                const requestedFields = input.select
                  .split(",")
                  .map((f) => f.trim())
                  .filter(Boolean);
                const actualKeys = Object.keys(
                  records[0] as Record<string, unknown>
                );
                missingFields.push(
                  ...requestedFields.filter((f) => !actualKeys.includes(f))
                );
                if (missingFields.length > 0) {
                  const warning = `Fields not returned by API (may not exist in this environment): ${missingFields.join(", ")}`;
                  appendApiLog({
                    ...logBase,
                    status: "warning",
                    warningMessage: warning,
                    recordCount: count,
                    durationMs: Date.now() - callStart,
                    resolvedEntity,
                    alternativesTried,
                    missingFields,
                  });
                }
              }

              // Build status suffix: show if a fallback entity was used
              const resolvedSuffix =
                resolvedEntity !== input.entity
                  ? ` (resolved via "${resolvedEntity}")`
                  : alternativesTried.length > 0
                  ? ` (after ${alternativesTried.length} fallback(s))`
                  : "";

              send({
                type: "status",
                message:
                  `${entityLabel} → ${count} records${resolvedSuffix}` +
                  (missingFields.length > 0
                    ? ` ⚠ missing fields: ${missingFields.join(", ")}`
                    : ""),
              });

              appendApiLog({
                ...logBase,
                status: "success",
                recordCount: count,
                durationMs: Date.now() - callStart,
                resolvedEntity,
                alternativesTried,
              });

              // Inform model: which entity was actually used + any absent fields
              const entityNote =
                resolvedEntity !== input.entity
                  ? `\n\n[NOTE: entity "${input.entity}" returned a server error — data was fetched from "${resolvedEntity}" instead.]`
                  : "";
              const schemaWarning =
                missingFields.length > 0
                  ? `\n\n[SCHEMA WARNING: the following fields were requested but not returned by the API — they likely do not exist for this entity in this environment: ${missingFields.join(", ")}. Do not reference or display these fields.]`
                  : "";

              allMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(data) + entityNote + schemaWarning,
              });
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              const aliases = ENTITY_ALIASES[input.entity.toUpperCase()] ?? [];
              const totalTried = 1 + aliases.length;
              send({
                type: "status",
                message: `Failed querying "${input.entity}" (tried ${totalTried} entity name(s))`,
              });

              appendApiLog({
                ...logBase,
                status: "error",
                errorMessage: errorMsg,
                durationMs: Date.now() - callStart,
                alternativesTried: aliases,
              });

              allMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Query failed for "${input.entity}"${aliases.length > 0 ? ` and alternatives [${aliases.join(", ")}]` : ""}: ${errorMsg}`,
              });
            }
          }
        }

        send({ type: "done" });
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : "An unexpected error occurred";
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
