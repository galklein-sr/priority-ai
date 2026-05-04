import { NextRequest, NextResponse } from "next/server";
import { ERP_ENTITIES } from "@/lib/erp-schema";
import { readSyncState, syncEntity, syncAllEntities } from "@/lib/fabric-sync";
import { SKIP_ENTITIES } from "@/lib/fabric-schema";

// Allow up to 5 minutes for a full sync on self-hosted / Vercel Pro
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json(readSyncState());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { entity?: string };
  const entityArg = body.entity?.toUpperCase();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
        } catch { /* controller closed */ }
      };

      const onProgress = (message: string) => send({ type: "progress", message });

      try {
        if (entityArg) {
          if (SKIP_ENTITIES.has(entityArg) || !ERP_ENTITIES[entityArg]) {
            send({ type: "error", message: `Unknown or unsyncable entity: ${entityArg}` });
          } else {
            const result = await syncEntity(entityArg, onProgress);
            send({ type: "done", entity: entityArg, result });
          }
        } else {
          const results = await syncAllEntities(undefined, onProgress);
          send({ type: "done", results });
        }
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
