/**
 * Priority ERP — Entity & Field Knowledge Base
 *
 * This file is the single source of truth for table definitions and field
 * explanations used by the AI assistant. Edit this file to teach the agent
 * about new entities, add Hebrew field aliases, or clarify business logic.
 */

export interface FieldDef {
  name: string;            // OData field name (exact, case-sensitive)
  hebrewName?: string;     // Hebrew label shown in Priority UI
  type: string;            // Data type: string | number | date | boolean | enum
  description: string;    // Plain-language explanation for the AI
  example?: string;        // Example value
}

export interface EntityDef {
  name: string;            // OData entity set name (e.g. "ORDERS")
  hebrewName?: string;     // Hebrew name shown in Priority menus
  description: string;    // What this entity represents
  fields: FieldDef[];
  queryTips?: string[];    // Common OData patterns specific to this entity
}

// ─── CUSTOMERS ───────────────────────────────────────────────────────────────

const CUSTOMERS: EntityDef = {
  name: "CUSTOMERS",
  hebrewName: "לקוחות",
  description: "Customer master data — all active and inactive customers of the company.",
  fields: [
    { name: "CUSTNAME",    hebrewName: "מספר לקוח",     type: "string",  description: "Unique customer code / ID", example: "400204" },
    { name: "CUSTDES",     hebrewName: "שם לקוח",        type: "string",  description: "Customer name in Hebrew" },
    { name: "ECUSTDES",    hebrewName: "שם לקוח באנגלית", type: "string",  description: "Customer name in English" },
    { name: "STATDES",     hebrewName: "סטטוס",          type: "string",  description: "Customer status ('פעיל' = active, 'לא פעיל' = inactive)" },
    { name: "INACTIVEFLAG",                               type: "enum",    description: "Null = active customer; 'Y' = inactive/blocked. Use filter='INACTIVEFLAG eq null' for active customers." },
    { name: "AGENTNAME",   hebrewName: "סוכן",           type: "string",  description: "Sales representative / agent code assigned to this customer" },
    { name: "AGENTDES",    hebrewName: "שם סוכן",        type: "string",  description: "Sales representative full name" },
    { name: "EMAIL",       hebrewName: "אימייל",          type: "string",  description: "Primary email address" },
    { name: "PHONE",       hebrewName: "טלפון",           type: "string",  description: "Primary phone number" },
    { name: "FAX",         hebrewName: "פקס",             type: "string",  description: "Fax number" },
    { name: "ADDRESS",     hebrewName: "כתובת",           type: "string",  description: "Street address" },
    { name: "CITY",        hebrewName: "עיר",             type: "string",  description: "City" },
    { name: "ZIP",         hebrewName: "מיקוד",           type: "string",  description: "Postal / ZIP code" },
    { name: "PAYDES",      hebrewName: "תנאי תשלום",      type: "string",  description: "Payment terms description (e.g. '30 יום שוטף')" },
    { name: "PAYCODE",                                    type: "string",  description: "Payment terms code" },
    { name: "OBCODE",      hebrewName: "מטבע",            type: "string",  description: "Default currency code for this customer (e.g. 'ILS', 'USD')" },
    { name: "WTAXDES",     hebrewName: "ניכוי מס במקור", type: "string",  description: "Withholding tax category" },
    { name: "PRICELIST",   hebrewName: "מחירון",          type: "string",  description: "Price list code assigned to this customer" },
    { name: "DISCOUNT",    hebrewName: "הנחה %",          type: "number",  description: "Default discount percentage for this customer" },
    { name: "CUSTPERSONNAME", hebrewName: "איש קשר",     type: "string",  description: "Primary contact person name" },
  ],
  queryTips: [
    "Active customers: filter=\"INACTIVEFLAG eq null\"",
    "Search by name: filter=\"contains(CUSTDES,'מילה')\"",
    "Get customer by code: filter=\"CUSTNAME eq '400204'\"",
    "Include sales rep: select=\"CUSTNAME,CUSTDES,AGENTDES,EMAIL,PHONE\"",
  ],
};

// ─── ORDERS (Sales Orders) ───────────────────────────────────────────────────

const ORDERS: EntityDef = {
  name: "ORDERS",
  hebrewName: "הזמנות מכירה",
  description: "Sales orders placed by customers. Each row is one order header. Order lines are in the ORDERITEMS_SUBFORM sub-entity.",
  fields: [
    { name: "ORDNAME",      hebrewName: "מספר הזמנה",    type: "string",  description: "Order number, e.g. 'SO2600001'", example: "SO2600001" },
    { name: "CUSTNAME",     hebrewName: "מספר לקוח",     type: "string",  description: "Customer code (FK to CUSTOMERS.CUSTNAME)" },
    { name: "CDES",         hebrewName: "שם לקוח",        type: "string",  description: "Customer name (denormalized from CUSTOMERS)" },
    { name: "CURDATE",      hebrewName: "תאריך הזמנה",   type: "date",    description: "Order creation date", example: "2026-01-15T00:00:00+02:00" },
    { name: "DUEDATE",      hebrewName: "תאריך אספקה",   type: "date",    description: "Requested delivery / due date" },
    { name: "TOTPRICE",     hebrewName: "סכום כולל",      type: "number",  description: "Total order value (in the order's currency)" },
    { name: "CODE",         hebrewName: "מטבע",            type: "string",  description: "Currency code: 'ILS' = ₪ Shekel, 'USD' = $" },
    { name: "ORDSTATUSDES", hebrewName: "סטטוס הזמנה",   type: "string",  description: "Human-readable order status (e.g. 'פתוחה', 'סגורה', 'בביצוע')" },
    { name: "BOOLCLOSED",                                  type: "enum",    description: "null = open order, 'Y' = closed/completed order. Use filter='BOOLCLOSED eq null' for open orders." },
    { name: "TYPEDES",      hebrewName: "סוג הזמנה",      type: "string",  description: "Order type description (e.g. 'הזמנת מכירה רגילה', 'הזמנת חירום')" },
    { name: "AGENTNAME",   hebrewName: "סוכן",            type: "string",  description: "Sales agent / rep who created or owns the order" },
    { name: "DISTRLINEDES", hebrewName: "קו הפצה",        type: "string",  description: "Distribution line / route for delivery" },
    { name: "DETAILS",     hebrewName: "הערות",            type: "string",  description: "Free-text notes on the order" },
    { name: "DISPRICE",    hebrewName: "מחיר לפני מע\"מ", type: "number",  description: "Total before VAT" },
    { name: "QPRICE",      hebrewName: "מחיר כולל מע\"מ", type: "number",  description: "Total including VAT" },
  ],
  queryTips: [
    "Open orders: filter=\"BOOLCLOSED eq null\"",
    "Closed orders: filter=\"BOOLCLOSED eq 'Y'\"",
    "Date range (this year): filter=\"CURDATE ge 2026-01-01T00:00:00+02:00 and CURDATE le 2026-12-31T23:59:59+02:00\"",
    "Newest first: orderby=\"CURDATE desc\"",
    "By customer: filter=\"CUSTNAME eq '400204'\"",
    "High-value orders: orderby=\"TOTPRICE desc\"",
    "Get order lines too: expand=\"ORDERITEMS_SUBFORM\"",
    "By agent: filter=\"AGENTNAME eq 'COHEN'\"",
  ],
};

// ─── ORDERITEMS (Order Lines — sub-entity of ORDERS) ─────────────────────────

const ORDERITEMS: EntityDef = {
  name: "ORDERITEMS_SUBFORM",
  hebrewName: "שורות הזמנה",
  description: "Individual line items within a sales order. Access via $expand=ORDERITEMS_SUBFORM on ORDERS.",
  fields: [
    { name: "KLINE",   hebrewName: "מס שורה",       type: "number",  description: "Line number within the order" },
    { name: "PARTNAME",hebrewName: "קוד פריט",       type: "string",  description: "Product/item code" },
    { name: "PDES",    hebrewName: "תיאור פריט",     type: "string",  description: "Product description" },
    { name: "TQUANT",  hebrewName: "כמות",            type: "number",  description: "Ordered quantity" },
    { name: "DQUANT",  hebrewName: "כמות שסופקה",    type: "number",  description: "Quantity already delivered" },
    { name: "BALANCE", hebrewName: "יתרה לאספקה",    type: "number",  description: "Remaining quantity to deliver (TQUANT - DQUANT)" },
    { name: "PRICE",   hebrewName: "מחיר יחידה",     type: "number",  description: "Unit price" },
    { name: "ICODE",   hebrewName: "מטבע",            type: "string",  description: "Currency code for this line" },
    { name: "TPRICE",  hebrewName: "סכום שורה",       type: "number",  description: "Line total (TQUANT × PRICE)" },
    { name: "QUANT",   hebrewName: "כמות מאושרת",     type: "number",  description: "Confirmed/approved quantity" },
    { name: "DUEDATE", hebrewName: "תאריך אספקה",    type: "date",    description: "Expected delivery date for this line" },
    { name: "UOMDES",  hebrewName: "יחידת מידה",      type: "string",  description: "Unit of measure (e.g. 'ק\"ג', 'יח')" },
    { name: "DISCOUNT",hebrewName: "הנחה %",          type: "number",  description: "Line-level discount percentage" },
  ],
  queryTips: [
    "Always access via ORDERS with $expand=ORDERITEMS_SUBFORM",
    "Example: entity=ORDERS, filter=\"ORDNAME eq 'SO2600001'\", expand=\"ORDERITEMS_SUBFORM\"",
  ],
};

// ─── LOGPART (Products / Inventory Items) ────────────────────────────────────

const LOGPART: EntityDef = {
  name: "LOGPART",
  hebrewName: "פריטים / מוצרים",
  description: "Product and inventory item master. Each row is one SKU or raw material.",
  fields: [
    { name: "PARTNAME",    hebrewName: "קוד פריט",       type: "string",  description: "Unique item/product code", example: "CHICK-001" },
    { name: "PARTDES",     hebrewName: "תיאור פריט",     type: "string",  description: "Product description (often in Hebrew)" },
    { name: "EPARTDES",    hebrewName: "תיאור באנגלית",   type: "string",  description: "Product description in English" },
    { name: "PARTTYPEDES", hebrewName: "סוג פריט",        type: "string",  description: "Product type/category (e.g. 'מוצר גמור', 'חומר גלם', 'שירות')" },
    { name: "STATDES",     hebrewName: "סטטוס",           type: "string",  description: "Item status ('פעיל' = active)" },
    { name: "PRICELISTD",  hebrewName: "מחיר מחירון",    type: "number",  description: "Standard list price" },
    { name: "UOMDES",      hebrewName: "יחידת מידה",      type: "string",  description: "Base unit of measure (e.g. 'ק\"ג', 'יח', 'ליטר')" },
    { name: "FAMILY",      hebrewName: "משפחה",           type: "string",  description: "Product family / group code" },
    { name: "FAMILYDES",   hebrewName: "שם משפחה",        type: "string",  description: "Product family name" },
    { name: "WARNQUANT",   hebrewName: "כמות מינימום",    type: "number",  description: "Minimum stock warning level" },
    { name: "LASTPRICE",   hebrewName: "מחיר אחרון",      type: "number",  description: "Last purchase price paid" },
  ],
  queryTips: [
    "Active items only: filter=\"STATDES eq 'פעיל'\" (or check INACTIVE field)",
    "Search by name: filter=\"contains(PARTDES,'עוף')\"",
    "By product type: filter=\"PARTTYPEDES eq 'מוצר גמור'\"",
  ],
};

// ─── SUPPLIERS ────────────────────────────────────────────────────────────────

const SUPPLIERS: EntityDef = {
  name: "SUPPLIERS",
  hebrewName: "ספקים",
  description: "Supplier master data — companies and individuals from whom goods or services are purchased.",
  fields: [
    { name: "SUPNAME",  hebrewName: "מספר ספק",    type: "string",  description: "Unique supplier code" },
    { name: "SUPDES",   hebrewName: "שם ספק",      type: "string",  description: "Supplier name" },
    { name: "AGENTNAME",hebrewName: "איש קשר",     type: "string",  description: "Contact / purchasing agent" },
    { name: "EMAIL",    hebrewName: "אימייל",        type: "string",  description: "Supplier email address" },
    { name: "PHONE",    hebrewName: "טלפון",         type: "string",  description: "Supplier phone number" },
    { name: "ADDRESS",  hebrewName: "כתובת",         type: "string",  description: "Street address" },
    { name: "CITY",     hebrewName: "עיר",           type: "string",  description: "City" },
    { name: "PAYDES",   hebrewName: "תנאי תשלום",    type: "string",  description: "Payment terms (e.g. 'שוטף + 60')" },
    { name: "OBCODE",   hebrewName: "מטבע",          type: "string",  description: "Default currency for purchases from this supplier" },
  ],
  queryTips: [
    "Search supplier: filter=\"contains(SUPDES,'שם ספק')\"",
    "Get by code: filter=\"SUPNAME eq 'SUP001'\"",
  ],
};

// ─── PORDERS (Purchase Orders) ────────────────────────────────────────────────

const PORDERS: EntityDef = {
  name: "PORDERS",
  hebrewName: "הזמנות רכש",
  description: "Purchase orders sent to suppliers. Each row is one PO header.",
  fields: [
    { name: "PORDNAME",     hebrewName: "מספר הזמנת רכש", type: "string",  description: "Purchase order number", example: "PO2600001" },
    { name: "SUPNAME",      hebrewName: "מספר ספק",       type: "string",  description: "Supplier code (FK to SUPPLIERS)" },
    { name: "SDES",         hebrewName: "שם ספק",          type: "string",  description: "Supplier name (denormalized)" },
    { name: "CURDATE",      hebrewName: "תאריך הזמנה",    type: "date",    description: "PO creation date" },
    { name: "DUEDATE",      hebrewName: "תאריך אספקה",    type: "date",    description: "Expected delivery date from supplier" },
    { name: "TOTPRICE",     hebrewName: "סכום כולל",       type: "number",  description: "Total PO value" },
    { name: "CODE",         hebrewName: "מטבע",             type: "string",  description: "Currency code" },
    { name: "BOOLCLOSED",                                   type: "enum",    description: "null = open PO, 'Y' = closed" },
    { name: "AGENTNAME",   hebrewName: "רוכש",             type: "string",  description: "Purchasing agent who created the PO" },
    { name: "DETAILS",     hebrewName: "הערות",             type: "string",  description: "Free-text notes" },
  ],
  queryTips: [
    "Open purchase orders: filter=\"BOOLCLOSED eq null\"",
    "By supplier: filter=\"SUPNAME eq 'SUP001'\"",
    "Recent POs: orderby=\"CURDATE desc\"",
  ],
};

// ─── INVOICES ────────────────────────────────────────────────────────────────

const INVOICES: EntityDef = {
  name: "INVOICES",
  hebrewName: "חשבוניות",
  description: "Customer invoices (outgoing). Created from sales orders after delivery.",
  fields: [
    { name: "IVNUM",     hebrewName: "מספר חשבונית",  type: "string",  description: "Invoice number" },
    { name: "CUSTNAME",  hebrewName: "מספר לקוח",     type: "string",  description: "Customer code" },
    { name: "CDES",      hebrewName: "שם לקוח",        type: "string",  description: "Customer name" },
    { name: "IVDATE",    hebrewName: "תאריך חשבונית",  type: "date",    description: "Invoice date" },
    { name: "DUEDATE",   hebrewName: "תאריך פירעון",   type: "date",    description: "Payment due date" },
    { name: "TOTPRICE",  hebrewName: "סכום כולל",       type: "number",  description: "Invoice total amount" },
    { name: "CODE",      hebrewName: "מטבע",            type: "string",  description: "Currency code" },
    { name: "BOOLCLOSED",                               type: "enum",    description: "null = open/unpaid, 'Y' = paid/closed" },
    { name: "IVSTATUSDES",hebrewName: "סטטוס",         type: "string",  description: "Invoice status description" },
  ],
  queryTips: [
    "Unpaid invoices: filter=\"BOOLCLOSED eq null\"",
    "By customer: filter=\"CUSTNAME eq '400204'\"",
    "Overdue: filter=\"BOOLCLOSED eq null and DUEDATE lt 2026-03-01T00:00:00+02:00\"",
  ],
};

// ─── DOCUMENTS_D (Delivery Notes / Shipping Documents) ───────────────────────

const DOCUMENTS_D: EntityDef = {
  name: "DOCUMENTS_D",
  hebrewName: "תעודות משלוח",
  description: "Delivery notes / shipping documents that record goods dispatched to customers.",
  fields: [
    { name: "DOCNO",    hebrewName: "מספר תעודה",    type: "string",  description: "Delivery note number" },
    { name: "CUSTNAME", hebrewName: "מספר לקוח",     type: "string",  description: "Customer code" },
    { name: "CDES",     hebrewName: "שם לקוח",        type: "string",  description: "Customer name" },
    { name: "CURDATE",  hebrewName: "תאריך",          type: "date",    description: "Delivery date" },
    { name: "TOTQUANT", hebrewName: "כמות כוללת",     type: "number",  description: "Total quantity shipped" },
    { name: "TOTPRICE", hebrewName: "שווי כולל",       type: "number",  description: "Total value of goods delivered" },
    { name: "BOOLCLOSED",                             type: "enum",    description: "null = draft/open, 'Y' = confirmed" },
    { name: "DISTRLINEDES",hebrewName: "קו הפצה",    type: "string",  description: "Distribution route" },
  ],
  queryTips: [
    "Recent deliveries: orderby=\"CURDATE desc\"",
    "By customer: filter=\"CUSTNAME eq '400204'\"",
    "Today's deliveries: filter=\"CURDATE ge 2026-03-03T00:00:00+02:00\"",
  ],
};

// ─── ACCBAL (Account Balances) ────────────────────────────────────────────────

const ACCBAL: EntityDef = {
  name: "ACCBAL",
  hebrewName: "יתרות חשבונות",
  description: "Account balances — outstanding receivables and payables per customer or supplier.",
  fields: [
    { name: "ACCNAME",  hebrewName: "מספר חשבון",    type: "string",  description: "Account code (customer or supplier code)" },
    { name: "ACCDES",   hebrewName: "שם חשבון",       type: "string",  description: "Account / customer / supplier name" },
    { name: "BALANCE",  hebrewName: "יתרה",            type: "number",  description: "Current outstanding balance (positive = owes money to company)" },
    { name: "CODE",     hebrewName: "מטבע",            type: "string",  description: "Currency code" },
  ],
  queryTips: [
    "Get customer balance: filter=\"ACCNAME eq '400204'\"",
    "Large balances first: orderby=\"BALANCE desc\"",
  ],
};

// ─── Entity alias / fallback map ─────────────────────────────────────────────
//
// When the AI requests an entity that returns a 5xx error, the system tries
// each alias in order until one succeeds.  Keys are upper-cased at runtime so
// casing in AI output doesn't matter.
//
// Sources: Priority ERP naming conventions + live OData entity list at
//   https://aipriority.priorityweb.cloud/odata/priority/tabula.ini/moftov/
// Postman collection reference: https://documenter.getpostman.com/view/30274649/2sB3QRmRt4

export const ENTITY_ALIASES: Record<string, string[]> = {
  // ── Products / Inventory ─────────────────────────────────────────────────
  // "PART" was the old entity name; Priority renamed it to "LOGPART"
  PART:             ['LOGPART'],
  PARTS:            ['LOGPART'],
  PRODUCTS:         ['LOGPART'],
  ITEMS:            ['LOGPART'],
  INVENTORY:        ['LOGPART'],

  // ── Sales Invoices ───────────────────────────────────────────────────────
  // Priority has several invoice forms; AINVOICES is the most common tax-invoice
  INVOICES:         ['AINVOICES', 'CINVOICES'],
  AINVOICES:        ['INVOICES',  'CINVOICES'],
  CINVOICES:        ['INVOICES',  'AINVOICES'],
  TAXINVOICES:      ['AINVOICES', 'INVOICES'],

  // ── Delivery / Shipping Documents ────────────────────────────────────────
  DOCUMENTS:        ['DOCUMENTS_D'],
  DELIVERIES:       ['DOCUMENTS_D'],
  DELIVERYNOTES:    ['DOCUMENTS_D'],
  TDELIVERIES:      ['DOCUMENTS_D'],
  SHIPMENTS:        ['DOCUMENTS_D'],
  DELIVERY:         ['DOCUMENTS_D'],

  // ── Purchase Orders ──────────────────────────────────────────────────────
  PURCHORDERS:      ['PORDERS'],
  PURCHASEORDERS:   ['PORDERS'],
  PURCHASE_ORDERS:  ['PORDERS'],
  PURCHORD:         ['PORDERS'],

  // ── Customers ────────────────────────────────────────────────────────────
  CLIENTS:          ['CUSTOMERS'],
  CLIENT:           ['CUSTOMERS'],
  CUSTOMER:         ['CUSTOMERS'],

  // ── Suppliers / Vendors ──────────────────────────────────────────────────
  VENDOR:           ['SUPPLIERS'],
  VENDORS:          ['SUPPLIERS'],
  SUPPLIER:         ['SUPPLIERS'],

  // ── Account Balances ─────────────────────────────────────────────────────
  BALANCE:          ['ACCBAL'],
  BALANCES:         ['ACCBAL'],
  ACCOUNTBALANCE:   ['ACCBAL'],
  ACCBALANCES:      ['ACCBAL'],
};

// ─── Exported registry ────────────────────────────────────────────────────────

export const ERP_ENTITIES: Record<string, EntityDef> = {
  CUSTOMERS,
  ORDERS,
  ORDERITEMS_SUBFORM: ORDERITEMS,
  LOGPART,
  SUPPLIERS,
  PORDERS,
  INVOICES,
  DOCUMENTS_D,
  ACCBAL,
};

/**
 * Generates a concise schema reference string for injection into the AI system prompt.
 * Keeps token count low while giving the model full field awareness.
 */
export function buildSchemaReference(): string {
  const sections = Object.values(ERP_ENTITIES).map((entity) => {
    const fieldLines = entity.fields
      .map((f) => {
        const heb = f.hebrewName ? ` [${f.hebrewName}]` : "";
        const ex  = f.example    ? ` — e.g. "${f.example}"` : "";
        return `  • ${f.name}${heb} (${f.type}): ${f.description}${ex}`;
      })
      .join("\n");

    const tips = entity.queryTips
      ? "\n  Query tips:\n" + entity.queryTips.map((t) => `  → ${t}`).join("\n")
      : "";

    const heb = entity.hebrewName ? ` (${entity.hebrewName})` : "";
    return `### ${entity.name}${heb}\n${entity.description}\n${fieldLines}${tips}`;
  });

  return sections.join("\n\n");
}
