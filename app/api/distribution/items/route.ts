import { NextRequest, NextResponse } from "next/server";
import { queryPriorityERP } from "@/lib/erp-client";

export interface OrderItemLine {
  ordName: string;
  kline: number;
  partName: string;
  pdes: string;
  tquant: number;
  dquant: number;
  uomdes: string;
  tprice: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ordersParam = searchParams.get("orders");

  if (!ordersParam) {
    return NextResponse.json({ error: "orders param required" }, { status: 400 });
  }

  const orderNames = ordersParam.split(",").filter(Boolean).slice(0, 50);
  if (orderNames.length === 0) return NextResponse.json({ lines: [] });

  const filter = orderNames
    .map((o) => `ORDNAME eq '${o.replace(/'/g, "''")}'`)
    .join(" or ");

  try {
    const r = await queryPriorityERP({
      entity: "ORDERS",
      filter,
      expand: "ORDERITEMS_SUBFORM",
      top: orderNames.length,
    });

    const lines: OrderItemLine[] = [];
    for (const order of (r.data?.value ?? [])) {
      for (const item of (order.ORDERITEMS_SUBFORM ?? [])) {
        lines.push({
          ordName: order.ORDNAME ?? "",
          kline: Number(item.KLINE ?? 0),
          partName: item.PARTNAME ?? "",
          pdes: item.PDES ?? "",
          tquant: Number(item.TQUANT ?? 0),
          dquant: Number(item.DQUANT ?? 0),
          uomdes: item.UOMDES ?? "",
          tprice: Number(item.TPRICE ?? 0),
        });
      }
    }

    return NextResponse.json({ lines });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
