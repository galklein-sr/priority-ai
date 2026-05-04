import { NextRequest, NextResponse } from "next/server";
import { queryPriorityERP } from "@/lib/erp-client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customersParam = searchParams.get("customers");

  if (!customersParam) {
    return NextResponse.json({ error: "customers param required" }, { status: 400 });
  }

  const customerNames = customersParam.split(",").filter(Boolean).slice(0, 60);
  if (customerNames.length === 0) return NextResponse.json({ addresses: [] });

  const filter = customerNames
    .map((c) => `CUSTNAME eq '${c.replace(/'/g, "''")}'`)
    .join(" or ");

  try {
    const r = await queryPriorityERP({
      entity: "CUSTOMERS",
      filter,
      select: "CUSTNAME,CUSTDES,ADDRESS,STATE,ZIP,GPSX,GPSY",
      top: 200,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addresses = (r.data?.value ?? []).map((c: any) => ({
      custName: c.CUSTNAME ?? "",
      custDes: c.CUSTDES ?? "",
      address: c.ADDRESS ?? "",
      city: c.STATE ?? "",     // STATE = city in Priority ERP
      zip: c.ZIP ?? "",
      gpsx: c.GPSX ?? null,    // longitude (34.xx in Israel)
      gpsy: c.GPSY ?? null,    // latitude (31-33 in Israel)
    }));

    return NextResponse.json({ addresses });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
