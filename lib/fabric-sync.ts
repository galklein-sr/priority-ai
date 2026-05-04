import sql from "mssql";
import fs from "fs";
import path from "path";
import { ERP_ENTITIES, FieldDef } from "@/lib/erp-schema";
import { queryAllPages } from "@/lib/erp-client";
import { getPool, executeSql } from "@/lib/fabric-client";
import {
  ENTITY_PRIMARY_KEYS,
  SKIP_ENTITIES,
  generateCreateTableDdl,
} from "@/lib/fabric-schema";

// ─── Sync state persistence ────────────────────────────────────────────────────

const STATE_FILE = path.join(process.cwd(), "data", "fabric-sync-state.json");

export interface SyncStatus {
  lastSync: string | null;
  recordCount: number;
  durationMs: number;
  status: "success" | "error" | "never";
  errorMessage?: string;
}

export type SyncState = Record<string, SyncStatus>;

export function readSyncState(): SyncState {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as SyncState;
  } catch {
    return {};
  }
}

function writeSyncState(state: SyncState): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updateState(entityName: string, status: SyncStatus): SyncStatus {
  const state = readSyncState();
  state[entityName] = status;
  writeSyncState(state);
  return status;
}

export type ProgressCallback = (message: string) => void;

// ─── Value coercion ────────────────────────────────────────────────────────────

function coerceValue(
  field: FieldDef,
  raw: unknown
): { sqlType: sql.ISqlType; value: unknown } {
  if (raw === null || raw === undefined) {
    return { sqlType: sql.NVarChar(255), value: null };
  }
  switch (field.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : parseFloat(String(raw));
      return { sqlType: sql.Decimal(18, 4), value: isNaN(n) ? null : n };
    }
    case "date":
      // Store as string — Fabric SQL Warehouse casts implicitly
      return { sqlType: sql.NVarChar(50), value: String(raw).slice(0, 50) };
    case "enum":
    case "boolean":
      return { sqlType: sql.NVarChar(10), value: String(raw).slice(0, 10) };
    default:
      return { sqlType: sql.NVarChar(255), value: String(raw).slice(0, 255) };
  }
}

// ─── Bulk insert ───────────────────────────────────────────────────────────────

const INSERT_BATCH_SIZE = 100; // rows per INSERT statement

async function bulkInsert(
  entityName: string,
  fields: FieldDef[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records: Record<string, any>[],
  onProgress: ProgressCallback
): Promise<void> {
  if (records.length === 0) return;

  const pool = await getPool();
  const colNames = fields.map((f) => `[${f.name}]`).join(", ");

  for (let i = 0; i < records.length; i += INSERT_BATCH_SIZE) {
    const batch = records.slice(i, i + INSERT_BATCH_SIZE);
    const req = pool.request();
    const rowPlaceholders: string[] = [];

    batch.forEach((record, rowIdx) => {
      const paramRefs: string[] = [];
      fields.forEach((field) => {
        const paramName = `r${rowIdx}_${field.name}`;
        const { sqlType, value } = coerceValue(field, record[field.name]);
        req.input(paramName, sqlType, value);
        paramRefs.push(`@${paramName}`);
      });
      rowPlaceholders.push(`(${paramRefs.join(", ")})`);
    });

    await req.query(
      `INSERT INTO dbo.[${entityName}] (${colNames}) VALUES ${rowPlaceholders.join(",\n")}`
    );

    const inserted = Math.min(i + INSERT_BATCH_SIZE, records.length);
    if (inserted < records.length) {
      onProgress(`${entityName}: שורה ${inserted} / ${records.length}`);
    }
  }
}

// ─── Primary key ordering ──────────────────────────────────────────────────────

function getPkOrderBy(entityName: string): string {
  const pk = ENTITY_PRIMARY_KEYS[entityName];
  return Array.isArray(pk) ? pk[0] : (pk ?? "");
}

// ─── syncEntity ────────────────────────────────────────────────────────────────

export async function syncEntity(
  entityName: string,
  onProgress: ProgressCallback = () => {}
): Promise<SyncStatus> {
  if (SKIP_ENTITIES.has(entityName)) {
    return { lastSync: null, recordCount: 0, durationMs: 0, status: "never" };
  }

  const entity = ERP_ENTITIES[entityName];
  if (!entity) throw new Error(`Unknown entity: ${entityName}`);

  const start = Date.now();

  try {
    // 1. Create table if it doesn't exist
    onProgress(`${entityName}: יוצר טבלה אם לא קיימת...`);
    const ddl = generateCreateTableDdl(entityName);
    if (ddl) await executeSql(ddl);

    // 2. Fetch all records from Priority ERP
    onProgress(`${entityName}: מביא נתונים מ-ERP...`);
    const { data } = await queryAllPages(
      { entity: entityName, orderby: getPkOrderBy(entityName) },
      onProgress
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records: Record<string, any>[] = Array.isArray(data?.value) ? data.value : [];
    onProgress(`${entityName}: ${records.length} רשומות התקבלו`);

    // 3. Truncate existing data
    onProgress(`${entityName}: מנקה נתונים קיימים...`);
    await executeSql(
      `IF OBJECT_ID('dbo.[${entityName}]', 'U') IS NOT NULL TRUNCATE TABLE dbo.[${entityName}]`
    );

    // 4. Bulk insert
    if (records.length > 0) {
      onProgress(`${entityName}: מכניס ${records.length} שורות...`);
      await bulkInsert(entityName, entity.fields, records, onProgress);
    }

    const status: SyncStatus = {
      lastSync: new Date().toISOString(),
      recordCount: records.length,
      durationMs: Date.now() - start,
      status: "success",
    };
    onProgress(`${entityName}: ✓ הושלם (${records.length} רשומות, ${status.durationMs}ms)`);
    return updateState(entityName, status);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status: SyncStatus = {
      lastSync: new Date().toISOString(),
      recordCount: 0,
      durationMs: Date.now() - start,
      status: "error",
      errorMessage,
    };
    onProgress(`${entityName}: ✗ שגיאה — ${errorMessage.slice(0, 120)}`);
    updateState(entityName, status);
    throw error;
  }
}

// ─── syncAllEntities ───────────────────────────────────────────────────────────

export async function syncAllEntities(
  entityNames: string[] = Object.keys(ERP_ENTITIES).filter(
    (n) => !SKIP_ENTITIES.has(n)
  ),
  onProgress: ProgressCallback = () => {}
): Promise<SyncState> {
  const results: SyncState = {};

  for (const name of entityNames) {
    onProgress(`=== מסנכרן ${name} ===`);
    try {
      results[name] = await syncEntity(name, onProgress);
    } catch (error) {
      results[name] = {
        lastSync: new Date().toISOString(),
        recordCount: 0,
        durationMs: 0,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      // Continue with next entity — partial sync is better than none
    }
  }

  return results;
}
