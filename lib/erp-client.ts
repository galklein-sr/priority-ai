import { ENTITY_ALIASES } from "@/lib/erp-schema";

export const PRIORITY_BASE_URL =
  process.env.PRIORITY_BASE_URL ||
  "https://aipriority.priorityweb.cloud/odata/priority/tabula.ini/otttt";

export const PRIORITY_CREDS = Buffer.from(
  `${process.env.PRIORITY_USERNAME || "6AAE9884207242A0B371BE5C7B5DB639"}:${process.env.PRIORITY_PASSWORD || "PAT"}`
).toString("base64");

export const PAGE_SIZE = 200;

export interface QueryResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  resolvedEntity: string;
  alternativesTried: string[];
}

export type QueryParams = {
  entity: string;
  filter?: string;
  select?: string;
  top?: number;
  skip?: number;
  orderby?: string;
  expand?: string;
  fetchAll?: boolean;
};

export function buildErpUrl(entity: string, params: QueryParams): string {
  const url = new URL(`${PRIORITY_BASE_URL}/${entity}`);
  if (params.filter) url.searchParams.set("$filter", params.filter);
  if (params.select) url.searchParams.set("$select", params.select);
  url.searchParams.set("$top", String(Math.min(Math.max(params.top ?? 50, 1), 200)));
  if (params.skip && params.skip > 0) url.searchParams.set("$skip", String(params.skip));
  if (params.orderby) url.searchParams.set("$orderby", params.orderby);
  if (params.expand) url.searchParams.set("$expand", params.expand);
  return url.toString();
}

export async function queryPriorityERP(
  params: QueryParams,
  onAlternative?: (failedEntity: string, nextEntity: string, errorMsg: string) => void
): Promise<QueryResult> {
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

    if (res.status < 500) throw new Error(errMsg);

    lastError = new Error(errMsg);
    tried.push(entityName);

    const nextIdx = candidates.indexOf(entityName) + 1;
    if (nextIdx < candidates.length) {
      onAlternative?.(entityName, candidates[nextIdx], errMsg);
    }
  }

  throw lastError;
}

export async function queryAllPages(
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
