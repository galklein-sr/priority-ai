import { ERP_ENTITIES, FieldDef } from "@/lib/erp-schema";

// Sub-entities accessed only via $expand — not synced as standalone tables
const SKIP_ENTITIES = new Set(["ORDERITEMS_SUBFORM"]);

export const ENTITY_PRIMARY_KEYS: Record<string, string | string[]> = {
  CUSTOMERS:   "CUSTNAME",
  ORDERS:      "ORDNAME",
  LOGPART:     "PARTNAME",
  AGENTS:      "AGENTNAME",
  INVOICES:    "IVNUM",
  AINVOICES:   "IVNUM",
  DOCUMENTS_D: "DOCNO",
  DOCUMENTS_N: "DOCNO",
  ACCBAL:      "ACCNAME",
  PARTBAL:     ["PARTNAME", "WARHSNAME"],
  WAREHOUSES:  "WARHSNAME",
  PRICELIST:   "PLNAME",
  SERIAL:      "SERIALNAME",
};

function erpTypeToDdl(field: FieldDef): string {
  switch (field.type) {
    case "number":  return "DECIMAL(18,4)";
    // Dates stored as NVARCHAR(50) — Priority returns ISO strings with tz offsets
    // (e.g. "2026-01-15T00:00:00+02:00") that Fabric casts implicitly.
    case "date":    return "NVARCHAR(50)";
    case "enum":    return "NVARCHAR(10)";
    case "boolean": return "NVARCHAR(10)";
    default:        return "NVARCHAR(255)";
  }
}

export function generateCreateTableDdl(entityName: string): string | null {
  const entity = ERP_ENTITIES[entityName];
  if (!entity || SKIP_ENTITIES.has(entityName)) return null;

  const pk = ENTITY_PRIMARY_KEYS[entityName];
  const pkCols = Array.isArray(pk) ? pk : [pk];

  const columnDefs = entity.fields
    .map((f) => {
      const nullable = pkCols.includes(f.name) ? "NOT NULL" : "NULL";
      return `    [${f.name}] ${erpTypeToDdl(f)} ${nullable}`;
    })
    .join(",\n");

  const pkConstraint = pkCols.map((c) => `[${c}]`).join(", ");

  return `IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = '${entityName}' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.[${entityName}] (
${columnDefs},
    CONSTRAINT [PK_${entityName}] PRIMARY KEY CLUSTERED (${pkConstraint})
  );
END`;
}

export function generateAllCreateDdl(): string {
  return Object.keys(ERP_ENTITIES)
    .filter((name) => !SKIP_ENTITIES.has(name))
    .map((name) => generateCreateTableDdl(name))
    .filter((ddl): ddl is string => ddl !== null)
    .join("\n\n");
}

export { SKIP_ENTITIES };
