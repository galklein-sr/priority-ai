import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

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
  status: "success" | "error";
  recordCount?: number;
  errorMessage?: string;
  durationMs: number;
}

function appendApiLog(entry: ApiLogEntry) {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Non-fatal — logging failure must not break the API
  }
}

function extractUserQuestion(messages: Anthropic.MessageParam[]): string {
  // Walk backwards to find the last user-turn text
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") return msg.content.trim();
      if (Array.isArray(msg.content)) {
        const textBlock = msg.content.find(
          (b): b is Anthropic.TextBlockParam => b.type === "text"
        );
        if (textBlock) return textBlock.text.trim();
      }
    }
  }
  return "unknown";
}
// ────────────────────────────────────────────────────────────────────────────

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PRIORITY_BASE_URL =
  process.env.PRIORITY_BASE_URL ||
  "https://aipriority.priorityweb.cloud/odata/priority/tabula.ini/moftov";

const PRIORITY_CREDS = Buffer.from(
  `${process.env.PRIORITY_USERNAME || "6AAE9884207242A0B371BE5C7B5DB639"}:${process.env.PRIORITY_PASSWORD || "PAT"}`
).toString("base64");

async function queryPriorityERP(params: {
  entity: string;
  filter?: string;
  select?: string;
  top?: number;
  orderby?: string;
  expand?: string;
}) {
  const url = new URL(`${PRIORITY_BASE_URL}/${params.entity}`);

  if (params.filter) url.searchParams.set("$filter", params.filter);
  if (params.select) url.searchParams.set("$select", params.select);
  url.searchParams.set(
    "$top",
    String(Math.min(Math.max(params.top ?? 20, 1), 50))
  );
  if (params.orderby) url.searchParams.set("$orderby", params.orderby);
  if (params.expand) url.searchParams.set("$expand", params.expand);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${PRIORITY_CREDS}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Priority API ${res.status}: ${body.slice(0, 300) || res.statusText}`
    );
  }

  return res.json();
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

**KEY ENTITIES & IMPORTANT FIELDS:**
- **CUSTOMERS**: Customer master data
  - CUSTNAME (customer code), CUSTDES (Hebrew name), ECUSTDES (English name), STATDES (status), AGENTNAME (sales rep), EMAIL, PHONE, PAYDES (payment terms), OBCODE (currency)
- **ORDERS**: Sales orders
  - ORDNAME (order number e.g. SO2600001), CUSTNAME (customer code), CDES (customer name), CURDATE (order date), DUEDATE (delivery date), TOTPRICE (total), CODE (currency), ORDSTATUSDES (status), BOOLCLOSED ('Y'=closed/null=open), TYPEDES (order type), AGENTNAME (sales rep), DISTRLINEDES (distribution line)
- **PART**: Products/items
  - PARTNAME (item code), PARTDES (description), PARTTYPEDES (product type), PRICELISTD (list price), STATDES (status)
- **SUPPLIERS**: Supplier master
  - SUPNAME (supplier code), SUPDES (name), AGENTNAME, EMAIL, PHONE
- **PORDERS**: Purchase orders
  - PORDNAME, SUPNAME, SDES (supplier name), CURDATE, DUEDATE, TOTPRICE, CODE, BOOLCLOSED
- **DOCUMENTS_D**: Delivery notes / shipping documents

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

**ODATA QUERY PATTERNS:**
- Open orders: filter="BOOLCLOSED eq null"
- Closed orders: filter="BOOLCLOSED eq 'Y'"
- Date range: filter="CURDATE ge 2026-01-01T00:00:00+02:00 and CURDATE le 2026-12-31T00:00:00+02:00"
- Active customers: filter="INACTIVEFLAG eq null"
- Contains search: filter="contains(CUSTDES,'term')"
- Specific order: filter="ORDNAME eq 'SO2600001'"
- Multiple conditions: filter="BOOLCLOSED eq null and CURDATE ge 2026-01-01T00:00:00+02:00"
- Sort newest first: orderby="CURDATE desc"
- Specific customer's orders: filter="CUSTNAME eq '400204'"`;

const tools: Anthropic.Tool[] = [
  {
    name: "query_priority_erp",
    description:
      "Query the Priority ERP system for live business data. Use this for any question about customers, sales orders, products, suppliers, purchase orders, or other business entities. Always use this tool rather than guessing.",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description:
            "The entity/table to query. Options: CUSTOMERS, ORDERS, PART, SUPPLIERS, PORDERS, DOCUMENTS_D, ACCBAL, INVOICES",
        },
        filter: {
          type: "string",
          description:
            "OData $filter expression. Examples: \"BOOLCLOSED eq null\" or \"CURDATE ge 2026-01-01T00:00:00+02:00\" or \"CUSTNAME eq '400204'\" or \"contains(CUSTDES,'term')\"",
        },
        select: {
          type: "string",
          description:
            "Comma-separated field names to return (improves performance). Example: \"ORDNAME,CUSTNAME,CDES,CURDATE,TOTPRICE,CODE,ORDSTATUSDES\"",
        },
        top: {
          type: "number",
          description:
            "Maximum number of records to return (1-50). Defaults to 20.",
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
];

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as {
    messages: Anthropic.MessageParam[];
  };

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
        let currentMessages: Anthropic.MessageParam[] = messages;
        let iterations = 0;
        const MAX_ITERATIONS = 8;

        while (iterations < MAX_ITERATIONS) {
          iterations++;

          // Use streaming for real-time text delivery
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msgStream = client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 8192,
            thinking: { type: "adaptive" } as any, // adaptive thinking — SDK types lag behind
            system: SYSTEM_PROMPT,
            tools,
            messages: currentMessages,
          });

          // Forward text tokens to client in real-time
          msgStream.on("text", (delta) => {
            send({ type: "token", text: delta });
          });

          // Wait for the full response (includes tool use blocks)
          const message = await msgStream.finalMessage();

          // Check for tool use blocks
          const toolUses = message.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );

          // No tool calls → conversation complete
          if (toolUses.length === 0) break;

          // Execute each tool call
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const toolUse of toolUses) {
            const input = toolUse.input as {
              entity: string;
              filter?: string;
              select?: string;
              top?: number;
              orderby?: string;
              expand?: string;
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
              const data = await queryPriorityERP(input);

              // Summarize result count for the status
              const count = Array.isArray(data?.value)
                ? data.value.length
                : 0;
              send({
                type: "status",
                message: `${entityLabel} → ${count} records`,
              });

              appendApiLog({
                ...logBase,
                status: "success",
                recordCount: count,
                durationMs: Date.now() - callStart,
              });

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(data),
              });
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              send({
                type: "status",
                message: `Error querying ${input.entity}`,
              });

              appendApiLog({
                ...logBase,
                status: "error",
                errorMessage: errorMsg,
                durationMs: Date.now() - callStart,
              });

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Query failed: ${errorMsg}`,
                is_error: true,
              });
            }
          }

          // Continue loop with tool results added to context
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: message.content },
            { role: "user", content: toolResults },
          ];
        }

        send({ type: "done" });
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "An unexpected error occurred";
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
