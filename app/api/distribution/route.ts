import { NextRequest, NextResponse } from "next/server";
import { queryPriorityERP } from "@/lib/erp-client";

export interface DistributionOrder {
  ORDNAME: string;
  CUSTNAME: string;
  CDES: string;
  DUEDATE: string;
  CURDATE: string;
  DISTRLINEDES: string;
  DISTRLINECODE: string;
  ZANA_DISTRORDER: number;
  ZANA_ORDPLASQUANT: number;
  TOTPRICE: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD
  const line = searchParams.get("line"); // optional distribution line code

  if (!date) {
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  // Israel timezone: use +03:00 in summer (Apr–Oct), +02:00 in winter
  const month = parseInt(date.slice(5, 7), 10);
  const tz = (month >= 4 && month <= 10) ? "+03:00" : "+02:00";
  const dateFrom = `${date}T00:00:00${tz}`;
  const dateTo   = `${date}T23:59:59${tz}`;

  const SELECT = "ORDNAME,CUSTNAME,CDES,DUEDATE,CURDATE,DISTRLINEDES,DISTRLINECODE,ZANA_DISTRORDER,ZANA_ORDPLASQUANT,TOTPRICE";
  const ORDER  = "ZANA_DISTRORDER asc,CUSTNAME asc";
  const lineFilter = line ? ` and DISTRLINECODE eq '${line}'` : "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapOrder = (o: any): DistributionOrder => ({
    ORDNAME:           o.ORDNAME           ?? "",
    CUSTNAME:          o.CUSTNAME          ?? "",
    CDES:              o.CDES              ?? "",
    DUEDATE:           o.DUEDATE           ?? "",
    CURDATE:           o.CURDATE           ?? "",
    DISTRLINEDES:      o.DISTRLINEDES      ?? "",
    DISTRLINECODE:     o.DISTRLINECODE     ?? "",
    ZANA_DISTRORDER:   Number(o.ZANA_DISTRORDER   ?? 0),
    ZANA_ORDPLASQUANT: Number(o.ZANA_ORDPLASQUANT ?? 0),
    TOTPRICE:          Number(o.TOTPRICE           ?? 0),
  });

  try {
    // Primary: filter by DUEDATE (planned delivery date) — no closed filter so historical dates work
    const dueDateFilter = `DUEDATE ge ${dateFrom} and DUEDATE le ${dateTo}${lineFilter}`;
    const r1 = await queryPriorityERP({ entity: "ORDERS", filter: dueDateFilter, select: SELECT, orderby: ORDER, top: 200 });
    let orders: DistributionOrder[] = (r1.data?.value ?? []).map(mapOrder);

    // Fallback: if DUEDATE yields nothing, try filtering by CURDATE (order creation date)
    if (orders.length === 0) {
      const curDateFilter = `CURDATE ge ${dateFrom} and CURDATE le ${dateTo}${lineFilter}`;
      const r2 = await queryPriorityERP({ entity: "ORDERS", filter: curDateFilter, select: SELECT, orderby: ORDER, top: 200 });
      orders = (r2.data?.value ?? []).map(mapOrder);
    }

    return NextResponse.json({ orders, date, tz });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
