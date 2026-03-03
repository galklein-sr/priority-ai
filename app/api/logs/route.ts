import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const LOG_FILE = path.join(process.cwd(), "logs", "priority-api-calls.jsonl");

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "200"), 1000);
  const entity = searchParams.get("entity"); // optional filter
  const status = searchParams.get("status"); // "success" | "error"

  if (!fs.existsSync(LOG_FILE)) {
    return NextResponse.json({ entries: [], total: 0 });
  }

  const raw = fs.readFileSync(LOG_FILE, "utf-8");
  const lines = raw.split("\n").filter(Boolean);

  // Parse JSONL
  const entries = lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

  // Apply filters
  const filtered = entries.filter((e) => {
    if (entity && e.entity !== entity.toUpperCase()) return false;
    if (status && e.status !== status) return false;
    return true;
  });

  // Return newest-first, limited
  const result = filtered.reverse().slice(0, limit);

  // Summary stats
  const successCount = filtered.filter((e) => e.status === "success").length;
  const errorCount = filtered.filter((e) => e.status === "error").length;

  const entityCounts: Record<string, number> = {};
  filtered.forEach((e) => {
    entityCounts[e.entity] = (entityCounts[e.entity] ?? 0) + 1;
  });

  return NextResponse.json({
    entries: result,
    total: filtered.length,
    stats: {
      success: successCount,
      error: errorCount,
      byEntity: entityCounts,
    },
  });
}
