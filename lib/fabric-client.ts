import sql from "mssql";

// ─── Azure AD token cache ──────────────────────────────────────────────────────

interface TokenEntry {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenEntry>();

async function getAccessToken(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.accessToken;

  const tenantId = process.env.FABRIC_TENANT_ID;
  const clientId = process.env.FABRIC_CLIENT_ID;
  const clientSecret = process.env.FABRIC_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Fabric credentials not configured. Set FABRIC_TENANT_ID, FABRIC_CLIENT_ID, FABRIC_CLIENT_SECRET in .env.local"
    );
  }

  const resp = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope,
      }),
    }
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Azure AD token fetch failed (${resp.status}): ${text.slice(0, 300)}`);
  }

  const json = await resp.json();
  const entry: TokenEntry = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  tokenCache.set(scope, entry);
  return entry.accessToken;
}

export function getSqlToken(): Promise<string> {
  return getAccessToken("https://database.windows.net/.default");
}

export function getFabricApiToken(): Promise<string> {
  return getAccessToken("https://api.fabric.microsoft.com/.default");
}

// ─── SQL connection pool ───────────────────────────────────────────────────────

interface PoolEntry {
  pool: sql.ConnectionPool;
  tokenExpiresAt: number;
}

const g = globalThis as typeof globalThis & { _fabricPoolEntry?: PoolEntry };

export async function getPool(): Promise<sql.ConnectionPool> {
  const endpoint = process.env.FABRIC_SQL_ENDPOINT;
  const database = process.env.FABRIC_DATABASE_NAME;

  if (!endpoint || !database) {
    throw new Error(
      "Fabric SQL not configured. Set FABRIC_SQL_ENDPOINT and FABRIC_DATABASE_NAME in .env.local"
    );
  }

  // Rebuild pool if missing, disconnected, or token about to expire
  if (g._fabricPoolEntry) {
    const { pool, tokenExpiresAt } = g._fabricPoolEntry;
    if (pool.connected && Date.now() < tokenExpiresAt - 300_000) {
      return pool;
    }
    try { await pool.close(); } catch { /* ignore */ }
    delete g._fabricPoolEntry;
  }

  const token = await getSqlToken();
  const cached = tokenCache.get("https://database.windows.net/.default")!;

  const pool = new sql.ConnectionPool({
    server: endpoint,
    database,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token },
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
  });

  await pool.connect();
  g._fabricPoolEntry = { pool, tokenExpiresAt: cached.expiresAt };
  return pool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeSql<T = Record<string, any>>(
  query: string
): Promise<sql.IRecordSet<T>> {
  const pool = await getPool();
  const result = await pool.request().query<T>(query);
  return result.recordset;
}

// ─── Fabric Data Agent REST API ───────────────────────────────────────────────

export interface FabricAgentResponse {
  answer: string;
  sql?: string;
  sessionId: string;
}

export async function queryFabricAgent(
  userMessage: string,
  sessionId: string
): Promise<FabricAgentResponse> {
  const workspaceId = process.env.FABRIC_WORKSPACE_ID;
  const agentId = process.env.FABRIC_DATA_AGENT_ID;

  if (!workspaceId || !agentId) {
    throw new Error(
      "Fabric Data Agent not configured. Set FABRIC_WORKSPACE_ID and FABRIC_DATA_AGENT_ID in .env.local"
    );
  }

  const token = await getFabricApiToken();

  const resp = await fetch(
    `https://api.fabric.microsoft.com/v1/workspaces/${workspaceId}/dataAgents/${agentId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userMessage, sessionId }),
    }
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Fabric Data Agent ${resp.status}: ${text.slice(0, 400)}`);
  }

  const json = await resp.json();

  return {
    answer: json.answer ?? json.text ?? json.content ?? JSON.stringify(json),
    sql: json.sql ?? json.generatedSql ?? undefined,
    sessionId: json.sessionId ?? sessionId,
  };
}
