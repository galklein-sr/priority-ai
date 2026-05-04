"use client";

import { useState, useCallback, Suspense, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { DistributionOrder } from "@/app/api/distribution/route";
import { getTruckConfig, type TruckConfig } from "@/lib/trucks-config";
import type { MapStop } from "./types";

// ─── Dynamic imports (SSR-safe) ───────────────────────────────────────────────

const Canvas = dynamic(() => import("@react-three/fiber").then((m) => m.Canvas), { ssr: false });
const OrbitControls = dynamic(
  () => import("@react-three/drei").then((m) => m.OrbitControls),
  { ssr: false }
);
const Text = dynamic(() => import("@react-three/drei").then((m) => m.Text), { ssr: false });
const MapModal = dynamic(() => import("./MapModal"), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface PalletSlot {
  row: number;   // 0 = back door, 4 = near cab
  col: number;   // 0 = left, 1 = right
  customers: Array<{ custName: string; cdes: string; packages: number; stopOrder: number }>;
  totalPackages: number;
}

interface TruckLoad {
  truckNumber: number;
  pallets: PalletSlot[];
}

interface AllTrucksLoad {
  trucks: TruckLoad[];
  totalPackages: number;
  unassigned: DistributionOrder[];
}

// ─── Packing Algorithm ────────────────────────────────────────────────────────
// Truck: 5 rows × 2 cols = 10 pallet slots
// Row 0 = back door (first to unload), Row 4 = near cab (last to unload)
// Loading order is reverse: stop 1 loaded LAST → ends up at row 0 (back door)
// Max 50 packages per pallet, max 3 customers per pallet

const MAX_PKG_PER_PALLET = 50;
const MAX_CUST_PER_PALLET = 3;

type CustomerEntry = { custName: string; cdes: string; packages: number; stopOrder: number };

function packOneTruck(customers: CustomerEntry[]): { pallets: PalletSlot[]; overflow: CustomerEntry[] } {
  const pallets: PalletSlot[] = [];
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 2; col++)
      pallets.push({ row, col, customers: [], totalPackages: 0 });

  const overflow: CustomerEntry[] = [];
  // Highest stop first → goes to front of truck (index 9..0)
  const reversed = [...customers].reverse();
  let palletIdx = pallets.length - 1;

  for (const cust of reversed) {
    let remaining = cust.packages;

    while (remaining > 0) {
      if (palletIdx < 0) break;
      const pallet = pallets[palletIdx];
      const canAdd = pallet.customers.length < MAX_CUST_PER_PALLET ||
        pallet.customers.some((c) => c.custName === cust.custName);
      const space = MAX_PKG_PER_PALLET - pallet.totalPackages;

      if (!canAdd || space <= 0) { palletIdx--; continue; }

      const placing = Math.min(remaining, space);
      const existing = pallet.customers.find((c) => c.custName === cust.custName);
      if (existing) existing.packages += placing;
      else pallet.customers.push({ ...cust, packages: placing });
      pallet.totalPackages += placing;
      remaining -= placing;
      if (pallet.totalPackages >= MAX_PKG_PER_PALLET) palletIdx--;
    }

    if (remaining > 0) overflow.push({ ...cust, packages: remaining });
  }

  return { pallets: pallets.filter((p) => p.customers.length > 0), overflow };
}

function packAllTrucks(orders: DistributionOrder[]): AllTrucksLoad {
  // Aggregate packages per customer-stop
  const custMap = new Map<string, CustomerEntry>();
  for (const o of orders) {
    const key = `${o.CUSTNAME}__${o.ZANA_DISTRORDER}`;
    const ex = custMap.get(key);
    if (ex) ex.packages += Math.max(o.ZANA_ORDPLASQUANT, 1);
    else custMap.set(key, {
      custName: o.CUSTNAME, cdes: o.CDES,
      packages: Math.max(o.ZANA_ORDPLASQUANT, 1),
      stopOrder: o.ZANA_DISTRORDER || 999,
    });
  }

  const totalPackages = Array.from(custMap.values()).reduce((s, c) => s + c.packages, 0);
  let remaining = Array.from(custMap.values()).sort((a, b) => a.stopOrder - b.stopOrder);
  const trucks: TruckLoad[] = [];

  while (remaining.length > 0) {
    const { pallets, overflow } = packOneTruck(remaining);
    trucks.push({ truckNumber: trucks.length + 1, pallets });
    if (overflow.length === remaining.length) break; // safety: no progress
    remaining = overflow;
  }

  const unassigned = orders.filter((o) =>
    remaining.some((r) => r.custName === o.CUSTNAME)
  );

  return { trucks, totalPackages, unassigned };
}

// ─── Color palette for customers ─────────────────────────────────────────────

const COLORS = [
  "#F59E0B", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6",
  "#F97316", "#06B6D4", "#84CC16", "#EC4899", "#14B8A6",
  "#A78BFA", "#FB7185", "#34D399", "#FBBF24", "#60A5FA",
];

// ─── Truck geometry constants ─────────────────────────────────────────────────
// Interior: 2.6 wide (x: -1.3..+1.3), 7.2 deep (z: -3.6..+3.6), 2.8 tall
// Pallets:  1.0 wide × 1.1 deep — col 0 center x=-0.65, col 1 center x=+0.65
// Rows z:   row 0 (back door) = -2.75 … row 4 (cab) = +2.75, spacing 1.375

const TRUCK = {
  floorW: 2.8,   // X
  floorD: 7.4,   // Z
  wallH: 2.8,
  wallX: 1.5,    // inner edge of side wall
  wallThick: 0.08,
  roofY: 2.85,
  doorZ: -3.75,  // back door Z
  frontZ: 3.75,  // cab wall Z
};

const PALLET = {
  w: 1.0,   // X
  d: 1.1,   // Z
  boardH: 0.08,
  colX: [-0.65, 0.65] as [number, number],
  rowZ: (row: number) => row * 1.375 - 2.75,
};

// ─── 3D Pallet Box ────────────────────────────────────────────────────────────

function PalletBox({
  slot, colorMap, isHighlighted, onClick, onHover,
}: {
  slot: PalletSlot;
  colorMap: Map<string, string>;
  isHighlighted: boolean;
  onClick: () => void;
  onHover: (slot: PalletSlot | null, x: number, y: number) => void;
}) {
  const layers = Math.max(1, Math.ceil(slot.totalPackages / 17));
  const boxHeight = layers * 0.38 + 0.08;

  const x = PALLET.colX[slot.col];
  const z = PALLET.rowZ(slot.row);
  const y = PALLET.boardH + boxHeight / 2;

  return (
    <group
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(slot, e.clientX, e.clientY); }}
      onPointerMove={(e) => { onHover(slot, e.clientX, e.clientY); }}
      onPointerOut={() => onHover(null, 0, 0)}
      position={[x, 0, z]}
    >
      {/* Wooden pallet board */}
      <mesh position={[0, PALLET.boardH / 2, 0]}>
        <boxGeometry args={[PALLET.w, PALLET.boardH, PALLET.d]} />
        <meshStandardMaterial color="#8B6914" roughness={0.9} />
      </mesh>
      {/* Stacked boxes — one segment per customer */}
      {slot.customers.map((cust, i) => {
        const segH = (cust.packages / slot.totalPackages) * boxHeight;
        const yBase = PALLET.boardH + slot.customers.slice(0, i).reduce(
          (s, c) => s + (c.packages / slot.totalPackages) * boxHeight, 0
        );
        const color = colorMap.get(cust.custName) ?? "#888";
        return (
          <mesh key={cust.custName} position={[0, yBase + segH / 2, 0]}>
            <boxGeometry args={[PALLET.w - 0.02, segH - 0.01, PALLET.d - 0.02]} />
            <meshStandardMaterial
              color={color}
              opacity={isHighlighted ? 1.0 : 0.88}
              transparent
              roughness={0.45}
              metalness={0.05}
            />
          </mesh>
        );
      })}
      {/* Highlight wireframe */}
      {isHighlighted && (
        <mesh position={[0, y, 0]}>
          <boxGeometry args={[PALLET.w + 0.06, boxHeight + 0.06, PALLET.d + 0.06]} />
          <meshStandardMaterial color="#FFFFFF" wireframe opacity={0.5} transparent />
        </mesh>
      )}
    </group>
  );
}

// ─── 3D Truck Scene ───────────────────────────────────────────────────────────

function TruckScene({
  truckLoad,
  colorMap,
  selectedPallet,
  onSelectPallet,
  onHover,
}: {
  truckLoad: TruckLoad;
  colorMap: Map<string, string>;
  selectedPallet: PalletSlot | null;
  onSelectPallet: (slot: PalletSlot | null) => void;
  onHover: (slot: PalletSlot | null, x: number, y: number) => void;
}) {
  // Build a lookup for filled slots
  const slotMap = new Map<string, PalletSlot>();
  for (const p of truckLoad.pallets) slotMap.set(`${p.row}-${p.col}`, p);

  const halfW = TRUCK.floorW / 2;
  const halfD = TRUCK.floorD / 2;
  const midH  = TRUCK.wallH / 2;

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 9, 4]} intensity={0.9} castShadow />
      <directionalLight position={[-4, 5, -6]} intensity={0.35} />

      {/* Floor */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[TRUCK.floorW, 0.08, TRUCK.floorD]} />
        <meshStandardMaterial color="#16162A" roughness={0.9} />
      </mesh>

      {/* Left wall (x = -wallX) */}
      <mesh position={[-(TRUCK.wallX + TRUCK.wallThick / 2), midH, 0]}>
        <boxGeometry args={[TRUCK.wallThick, TRUCK.wallH, TRUCK.floorD]} />
        <meshStandardMaterial color="#111126" opacity={0.75} transparent />
      </mesh>

      {/* Right wall (x = +wallX) */}
      <mesh position={[(TRUCK.wallX + TRUCK.wallThick / 2), midH, 0]}>
        <boxGeometry args={[TRUCK.wallThick, TRUCK.wallH, TRUCK.floorD]} />
        <meshStandardMaterial color="#111126" opacity={0.75} transparent />
      </mesh>

      {/* Roof */}
      <mesh position={[0, TRUCK.roofY, 0]}>
        <boxGeometry args={[TRUCK.floorW + TRUCK.wallThick * 2, 0.07, TRUCK.floorD]} />
        <meshStandardMaterial color="#0C0C1E" opacity={0.45} transparent />
      </mesh>

      {/* Back door opening glow (amber) */}
      <mesh position={[0, midH, TRUCK.doorZ - 0.02]}>
        <boxGeometry args={[TRUCK.floorW + TRUCK.wallThick * 2, TRUCK.wallH, 0.06]} />
        <meshStandardMaterial color="#F59E0B" opacity={0.12} transparent />
      </mesh>

      {/* Front cab wall */}
      <mesh position={[0, midH, TRUCK.frontZ + 0.02]}>
        <boxGeometry args={[TRUCK.floorW + TRUCK.wallThick * 2, TRUCK.wallH, 0.08]} />
        <meshStandardMaterial color="#0C0C1E" opacity={0.85} transparent />
      </mesh>

      {/* Back door label */}
      <Suspense fallback={null}>
        <Text
          position={[0, TRUCK.wallH + 0.3, TRUCK.doorZ]}
          fontSize={0.22}
          color="#F59E0B"
          anchorX="center"
          anchorY="middle"
          font={undefined}
        >
          פתח אחורי ◀
        </Text>
      </Suspense>

      {/* Pallet slots — all 10 positions */}
      {Array.from({ length: 5 }, (_, row) =>
        [0, 1].map((col) => {
          const key = `${row}-${col}`;
          const filled = slotMap.get(key);
          const px = PALLET.colX[col];
          const pz = PALLET.rowZ(row);

          if (filled) {
            return (
              <PalletBox
                key={key}
                slot={filled}
                colorMap={colorMap}
                isHighlighted={selectedPallet?.row === row && selectedPallet?.col === col}
                onClick={() => onSelectPallet(
                  selectedPallet?.row === row && selectedPallet?.col === col ? null : filled
                )}
                onHover={onHover}
              />
            );
          }

          // Empty pallet footprint
          return (
            <mesh key={key} position={[px, 0.02, pz]}>
              <boxGeometry args={[PALLET.w, 0.04, PALLET.d]} />
              <meshStandardMaterial color="#1C1C38" opacity={0.6} transparent />
            </mesh>
          );
        })
      )}

      {/* Row number labels on the left wall */}
      <Suspense fallback={null}>
        {[0, 1, 2, 3, 4].map((row) => (
          <Text
            key={row}
            position={[-(TRUCK.wallX - 0.05), 0.18, PALLET.rowZ(row)]}
            fontSize={0.14}
            color="#40406A"
            anchorX="center"
            anchorY="middle"
            font={undefined}
          >
            {`R${row + 1}`}
          </Text>
        ))}
      </Suspense>

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={4}
        maxDistance={18}
      />
    </>
  );
}

// ─── Loading sheet HTML generator ────────────────────────────────────────────

function generateLoadingSheetHTML(
  allTrucksData: AllTrucksLoad,
  allOrders: DistributionOrder[],
  date: string
): string {
  const dateFormatted = new Date(date + "T12:00:00").toLocaleDateString("he-IL");

  const stopGroupsMap = new Map<number, DistributionOrder[]>();
  for (const o of allOrders) {
    const stop = o.ZANA_DISTRORDER || 0;
    if (!stopGroupsMap.has(stop)) stopGroupsMap.set(stop, []);
    stopGroupsMap.get(stop)!.push(o);
  }
  const sortedStopsData = Array.from(stopGroupsMap.entries()).sort((a, b) => a[0] - b[0]);

  let trucksHTML = "";
  for (const truck of allTrucksData.trucks) {
    const cfg = getTruckConfig(truck.truckNumber);
    const slotMap = new Map<string, PalletSlot>();
    for (const p of truck.pallets) slotMap.set(`${p.row}-${p.col}`, p);

    let gridHTML = "";
    for (let row = 4; row >= 0; row--) {
      for (let col = 0; col < 2; col++) {
        const pallet = slotMap.get(`${row}-${col}`);
        const colLabel = col === 0 ? "שמאל" : "ימין";
        const rowNote = row === 4 ? " (קדמת משאית)" : row === 0 ? " (פתח אחורי)" : "";
        if (pallet) {
          const custRows = pallet.customers
            .map(
              (c) =>
                `<div class="cust-row"><span class="stop-badge">${c.stopOrder}</span>${c.cdes || c.custName}<span class="pkg">${c.packages}</span></div>`
            )
            .join("");
          gridHTML += `<div class="pcell"><div class="ph">שורה ${row + 1} · ${colLabel}${rowNote}<span class="ph-pkg">${pallet.totalPackages} אר'</span></div>${custRows}</div>`;
        } else {
          gridHTML += `<div class="pcell empty"><div class="ph empty-ph">שורה ${row + 1} · ${colLabel} — ריק</div></div>`;
        }
      }
    }

    trucksHTML += `
    <div class="truck">
      <h2>🚛 משאית ${truck.truckNumber} — ${cfg.driver}</h2>
      <div class="meta">
        <span><b>לוחית:</b> ${cfg.licensePlate}</span>
        <span><b>סוג:</b> ${cfg.type}</span>
        <span><b>מידות:</b> ${cfg.lengthM}×${cfg.widthM}×${cfg.heightM} מ'</span>
        <span><b>משטחים:</b> ${truck.pallets.length}/10</span>
        ${cfg.refrigerated ? "<span><b>❄ מקורר</b></span>" : ""}
      </div>
      <h3>סדר העמסה <small>(שורה 5 = קדמת משאית · שורה 1 = פתח אחורי)</small></h3>
      <div class="grid">${gridHTML}</div>
      <p class="note">* טוענים מהחלק הקדמי לאחורי — עצירה ראשונה נגישה ראשונה לפריקה</p>
    </div>`;
  }

  const stopsTableRows = sortedStopsData
    .map(([stop, stopOrders]) => {
      const totalPkg = stopOrders.reduce((s, o) => s + Math.max(o.ZANA_ORDPLASQUANT, 0), 0);
      const totalVal = stopOrders.reduce((s, o) => s + (o.TOTPRICE || 0), 0);
      return `<tr><td style="text-align:center;font-weight:bold">${stop || "-"}</td><td>${stopOrders[0]?.CDES || stopOrders[0]?.CUSTNAME || ""}</td><td style="text-align:center">${stopOrders.length}</td><td style="text-align:center;font-weight:bold">${totalPkg}</td><td>₪${totalVal.toLocaleString("he-IL")}</td><td>${stopOrders[0]?.DISTRLINEDES || ""}</td></tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<title>תכנון הפצה ${dateFormatted}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#000;background:#fff;padding:16px}
h1{font-size:18px;margin-bottom:4px}
h2{font-size:14px;margin:18px 0 8px;border-bottom:2px solid #000;padding-bottom:4px}
h3{font-size:12px;margin:10px 0 6px;color:#333}
h3 small{font-size:10px;color:#888;font-weight:normal}
.hdr{border-bottom:3px double #000;padding-bottom:10px;margin-bottom:16px}
.sub{color:#555;margin-top:4px;font-size:11px}
.truck{page-break-inside:avoid;margin-bottom:24px}
.meta{background:#f5f5f5;border:1px solid #ddd;padding:6px 10px;border-radius:3px;margin-bottom:10px;font-size:11px}
.meta span{margin-left:14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.pcell{border:1px solid #ccc;padding:5px 7px;border-radius:3px;min-height:44px}
.pcell.empty{background:#fafafa;border-style:dashed}
.ph{font-weight:bold;font-size:10px;color:#444;margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid #eee;display:flex;justify-content:space-between}
.ph-pkg{font-weight:normal;color:#666}
.empty-ph{color:#bbb}
.cust-row{display:flex;align-items:center;gap:4px;padding:2px 0;font-size:11px}
.stop-badge{background:#000;color:#fff;border-radius:2px;padding:1px 4px;font-size:9px;flex-shrink:0}
.pkg{margin-right:auto;font-weight:bold;margin-left:4px}
.note{font-size:10px;color:#999;margin-top:6px}
table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
th,td{border:1px solid #ddd;padding:5px 8px;text-align:right}
th{background:#f0f0f0;font-weight:bold}
tr:nth-child(even){background:#fafafa}
.footer{margin-top:16px;font-size:10px;color:#999;border-top:1px solid #ddd;padding-top:8px}
@media print{@page{margin:15mm}}
</style>
</head>
<body>
<div class="hdr">
  <h1>📦 תכנון הפצה — ${dateFormatted}</h1>
  <div class="sub">${allTrucksData.trucks.length} משאיות · ${allTrucksData.totalPackages} אריזות · ${allOrders.length} הזמנות</div>
</div>
${trucksHTML}
<div style="page-break-before:always">
  <h2>📍 סדר עצירות</h2>
  <table>
    <thead><tr><th>עצירה</th><th>לקוח</th><th>הזמנות</th><th>אריזות</th><th>שווי</th><th>קו הפצה</th></tr></thead>
    <tbody>${stopsTableRows}</tbody>
  </table>
</div>
<div class="footer">הופק: ${new Date().toLocaleString("he-IL")}</div>
<script>window.print();</script>
</body>
</html>`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DistributionPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [orders, setOrders] = useState<DistributionOrder[]>([]);
  const [allTrucks, setAllTrucks] = useState<AllTrucksLoad | null>(null);
  const [selectedTruck, setSelectedTruck] = useState(0); // index into allTrucks.trucks
  const [truckInfoVisible, setTruckInfoVisible] = useState(false);
  const [colorMap, setColorMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedPallet, setSelectedPallet] = useState<PalletSlot | null>(null);
  const [hoveredPallet, setHoveredPallet] = useState<PalletSlot | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<"truck" | "stops">("truck");
  const [showMap, setShowMap] = useState(false);
  const fetchedRef = useRef(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDownload = useCallback(() => {
    if (!allTrucks) return;
    const html = generateLoadingSheetHTML(allTrucks, orders, date);
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }, [allTrucks, orders, date]);

  const handleHover = useCallback((slot: PalletSlot | null, x: number, y: number) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    if (!slot) {
      hoverTimeout.current = setTimeout(() => setHoveredPallet(null), 80);
    } else {
      setHoveredPallet(slot);
      setHoverPos({ x, y });
    }
  }, []);

  useEffect(() => () => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); }, []);

  const loadDeliveries = useCallback(async (d: string) => {
    setLoading(true);
    setError("");
    setOrders([]);
    setAllTrucks(null);
    setSelectedTruck(0);
    setSelectedPallet(null);
    fetchedRef.current = true;

    try {
      const res = await fetch(`/api/distribution?date=${d}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "שגיאה בטעינת נתונים");

      const fetchedOrders: DistributionOrder[] = json.orders ?? [];
      setOrders(fetchedOrders);

      if (fetchedOrders.length === 0) return;

      const load = packAllTrucks(fetchedOrders);
      setAllTrucks(load);

      const custNames = [...new Set(fetchedOrders.map((o) => o.CUSTNAME))];
      const cm = new Map<string, string>();
      custNames.forEach((name, i) => cm.set(name, COLORS[i % COLORS.length]));
      setColorMap(cm);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const currentTruck = allTrucks?.trucks[selectedTruck] ?? null;
  const currentTruckConfig: TruckConfig | null = currentTruck
    ? getTruckConfig(currentTruck.truckNumber)
    : null;

  // Group orders by stop for the stops list
  const stopGroups = orders.reduce<Map<number, DistributionOrder[]>>((acc, o) => {
    const stop = o.ZANA_DISTRORDER || 0;
    if (!acc.has(stop)) acc.set(stop, []);
    acc.get(stop)!.push(o);
    return acc;
  }, new Map());
  const sortedStops = Array.from(stopGroups.entries()).sort((a, b) => a[0] - b[0]);

  const mapStops: MapStop[] = sortedStops
    .filter(([stop]) => stop > 0)
    .map(([stop, stopOrders]) => ({
      stopOrder: stop,
      custName: stopOrders[0]?.CUSTNAME ?? "",
      cdes: stopOrders[0]?.CDES ?? "",
      packages: stopOrders.reduce((s, o) => s + Math.max(o.ZANA_ORDPLASQUANT, 0), 0),
      ordCount: stopOrders.length,
    }));

  const totalPallets = currentTruck?.pallets.length ?? 0;

  return (
    <div
      className="flex flex-col h-dvh overflow-hidden"
      style={{ background: "var(--bg)", fontFamily: "Syne, sans-serif", direction: "rtl" }}
    >
      {/* ── Header ── */}
      <header
        className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
      >
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: "#50507A" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>חזרה לצ'אט</span>
        </Link>

        <div style={{ width: "1px", height: "18px", background: "var(--border)" }} />

        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.35))",
              border: "1px solid rgba(245,158,11,0.4)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
              <rect x="1" y="3" width="15" height="13" rx="1" />
              <path d="M16 8h4l3 3v5h-7V8z" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <span className="font-bold text-base" style={{ color: "#E8E8F8" }}>
            תכנון הפצה
          </span>
        </div>

        <div className="flex-1" />

        {/* Stats */}
        {allTrucks && (
          <div className="flex items-center gap-4 text-sm" style={{ color: "#50507A" }}>
            <span><span style={{ color: "#F59E0B" }}>{orders.length}</span> הזמנות</span>
            <span><span style={{ color: "#10B981" }}>{allTrucks.totalPackages}</span> אריזות</span>
            <span><span style={{ color: "#3B82F6" }}>{allTrucks.trucks.length}</span> משאיות</span>
            <span><span style={{ color: "#A78BFA" }}>{totalPallets}</span>/10 משטחים</span>
          </div>
        )}
      </header>

      {/* ── Controls bar ── */}
      <div
        className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <label className="text-sm font-medium" style={{ color: "#A0A0C0" }}>
          תאריך אספקה:
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-1.5 rounded text-sm"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "#E8E8F8",
            outline: "none",
            direction: "ltr",
          }}
        />
        <button
          onClick={() => loadDeliveries(date)}
          disabled={loading}
          className="px-4 py-1.5 rounded text-sm font-medium transition-all"
          style={{
            background: loading ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.2)",
            border: "1px solid rgba(245,158,11,0.4)",
            color: "#F59E0B",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "טוען..." : "טען משלוחים"}
        </button>

        {orders.length > 0 && (
          <div className="flex items-center gap-2 mr-auto flex-wrap">
            {/* Truck selector */}
            {allTrucks && allTrucks.trucks.length > 1 && (
              <div className="flex items-center gap-1 border rounded px-1" style={{ borderColor: "var(--border)" }}>
                <button
                  onClick={() => { setSelectedTruck((t) => Math.max(0, t - 1)); setSelectedPallet(null); setTruckInfoVisible(false); }}
                  disabled={selectedTruck === 0}
                  className="px-1.5 py-1 text-sm transition-opacity"
                  style={{ color: selectedTruck === 0 ? "#30304A" : "#A0A0C0" }}
                >‹</button>
                {allTrucks.trucks.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (selectedTruck === i) {
                        setTruckInfoVisible((v) => !v);
                      } else {
                        setSelectedTruck(i);
                        setSelectedPallet(null);
                        setTruckInfoVisible(true);
                      }
                    }}
                    className="px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1"
                    style={{
                      background: selectedTruck === i ? "rgba(59,130,246,0.2)" : "transparent",
                      color: selectedTruck === i ? "#60A5FA" : "#50507A",
                    }}
                  >
                    🚛 {i + 1}
                    {selectedTruck === i && (
                      <span style={{ color: truckInfoVisible ? "#60A5FA" : "#30304A", fontSize: "10px" }}>ℹ</span>
                    )}
                  </button>
                ))}
                <button
                  onClick={() => { setSelectedTruck((t) => Math.min(allTrucks.trucks.length - 1, t + 1)); setSelectedPallet(null); setTruckInfoVisible(false); }}
                  disabled={selectedTruck === allTrucks.trucks.length - 1}
                  className="px-1.5 py-1 text-sm transition-opacity"
                  style={{ color: selectedTruck === allTrucks.trucks.length - 1 ? "#30304A" : "#A0A0C0" }}
                >›</button>
              </div>
            )}

            {/* View tabs */}
            <div className="flex gap-1">
              {(["truck", "stops"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-3 py-1 rounded text-xs font-medium transition-all"
                  style={{
                    background: activeTab === tab ? "rgba(245,158,11,0.2)" : "transparent",
                    border: `1px solid ${activeTab === tab ? "rgba(245,158,11,0.4)" : "var(--border)"}`,
                    color: activeTab === tab ? "#F59E0B" : "#50507A",
                  }}
                >
                  {tab === "truck" ? "🚛 תצוגת משאית" : "📋 רשימת עצירות"}
                </button>
              ))}
            </div>

            {/* Download & Map buttons */}
            <div style={{ width: "1px", height: "18px", background: "var(--border)", flexShrink: 0 }} />
            <button
              onClick={handleDownload}
              className="px-3 py-1 rounded text-xs font-medium transition-all flex items-center gap-1.5"
              style={{
                background: "rgba(16,185,129,0.1)",
                border: "1px solid rgba(16,185,129,0.3)",
                color: "#10B981",
                cursor: "pointer",
              }}
            >
              📥 הורד העמסה
            </button>
            <button
              onClick={() => setShowMap(true)}
              className="px-3 py-1 rounded text-xs font-medium transition-all flex items-center gap-1.5"
              style={{
                background: "rgba(59,130,246,0.1)",
                border: "1px solid rgba(59,130,246,0.3)",
                color: "#60A5FA",
                cursor: "pointer",
              }}
            >
              🗺 מסלול הפצה
            </button>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mx-5 mt-3 px-4 py-2 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#F87171" }}>
          {error}
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && fetchedRef.current && orders.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3" style={{ color: "#50507A" }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="1" y="3" width="15" height="13" rx="1" />
            <path d="M16 8h4l3 3v5h-7V8z" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <p className="text-base">לא נמצאו משלוחים לתאריך {date}</p>
        </div>
      )}

      {!fetchedRef.current && !loading && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3" style={{ color: "#50507A" }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="1" y="3" width="15" height="13" rx="1" />
            <path d="M16 8h4l3 3v5h-7V8z" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <p className="text-base">בחר תאריך ולחץ &ldquo;טען משלוחים&rdquo;</p>
        </div>
      )}

      {/* ── Main content ── */}
      {currentTruck && orders.length > 0 && (
        <div className="flex flex-1 overflow-hidden gap-0">

          {/* ── 3D Truck View ── */}
          {activeTab === "truck" && (
            <div className="flex flex-1 overflow-hidden">
              {/* 3D Canvas */}
              <div className="flex-1 relative" style={{ minHeight: 0 }}>
                <Canvas
                  camera={{ position: [7, 6, -8], fov: 50 }}
                  style={{ background: "#060610" }}
                  shadows
                >
                  <TruckScene
                    truckLoad={currentTruck}
                    colorMap={colorMap}
                    selectedPallet={selectedPallet}
                    onSelectPallet={setSelectedPallet}
                    onHover={handleHover}
                  />
                </Canvas>

                {/* Instructions overlay */}
                <div
                  className="absolute bottom-3 left-3 text-xs px-3 py-1.5 rounded pointer-events-none"
                  style={{ background: "rgba(6,6,16,0.8)", color: "#50507A", border: "1px solid var(--border)" }}
                >
                  גלגל לזום • גרור לסובב • לחץ על משטח לפרטים
                </div>

                {/* Truck info card */}
                {truckInfoVisible && currentTruckConfig && (
                  <div
                    className="absolute top-3 left-3 text-xs rounded overflow-hidden"
                    style={{
                      background: "rgba(6,6,16,0.92)",
                      border: "1px solid rgba(59,130,246,0.35)",
                      width: "230px",
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    {/* Card header */}
                    <div
                      className="flex items-center justify-between px-3 py-2"
                      style={{ borderBottom: "1px solid rgba(59,130,246,0.2)", background: "rgba(59,130,246,0.08)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">🚛</span>
                        <div>
                          <div className="font-semibold" style={{ color: "#60A5FA" }}>
                            משאית {currentTruckConfig.id}
                          </div>
                          <div style={{ color: "#50507A", fontFamily: "JetBrains Mono, monospace" }}>
                            {currentTruckConfig.licensePlate}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setTruckInfoVisible(false)}
                        className="w-5 h-5 flex items-center justify-center rounded transition-opacity hover:opacity-70"
                        style={{ color: "#50507A" }}
                      >×</button>
                    </div>

                    {/* Driver */}
                    <div className="px-3 pt-2.5 pb-1 flex items-center gap-2.5">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                        style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60A5FA" }}
                      >
                        {currentTruckConfig.driver.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium" style={{ color: "#E8E8F8" }}>{currentTruckConfig.driver}</div>
                        {currentTruckConfig.phone && (
                          <div style={{ color: "#50507A", direction: "ltr" }}>{currentTruckConfig.phone}</div>
                        )}
                      </div>
                    </div>

                    <div className="px-3 pb-2.5 space-y-1.5 mt-1">
                      {/* Type row */}
                      <div className="flex items-center justify-between py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ color: "#50507A" }}>סוג רכב</span>
                        <div className="flex items-center gap-1.5">
                          {currentTruckConfig.refrigerated && (
                            <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: "rgba(6,182,212,0.15)", color: "#06B6D4", border: "1px solid rgba(6,182,212,0.25)" }}>
                              ❄ מקורר
                            </span>
                          )}
                          <span style={{ color: "#C0C0D8" }}>{currentTruckConfig.type}</span>
                        </div>
                      </div>

                      {/* Dimensions */}
                      <div className="flex items-center justify-between py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ color: "#50507A" }}>מידות (מ')</span>
                        <span style={{ color: "#C0C0D8", fontFamily: "JetBrains Mono, monospace" }}>
                          {currentTruckConfig.lengthM} × {currentTruckConfig.widthM} × {currentTruckConfig.heightM}
                        </span>
                      </div>

                      {/* Capacity rows */}
                      <div className="flex items-center justify-between py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ color: "#50507A" }}>קיבולת משטחים</span>
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-0.5">
                            {Array.from({ length: currentTruckConfig.maxPallets }, (_, i) => (
                              <div
                                key={i}
                                className="w-2 h-2 rounded-sm"
                                style={{
                                  background: i < (currentTruck?.pallets.length ?? 0)
                                    ? "#3B82F6"
                                    : "rgba(255,255,255,0.07)",
                                }}
                              />
                            ))}
                          </div>
                          <span style={{ color: "#60A5FA" }}>
                            {currentTruck?.pallets.length ?? 0}/{currentTruckConfig.maxPallets}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between py-1">
                        <span style={{ color: "#50507A" }}>משקל מקסימלי</span>
                        <span style={{ color: "#C0C0D8" }}>
                          {(currentTruckConfig.maxWeightKg / 1000).toFixed(1)} טון
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Top-right: legend OR selected pallet card */}
                <div
                  className="absolute top-3 right-3 text-xs rounded overflow-hidden transition-all"
                  style={{
                    background: "rgba(6,6,16,0.92)",
                    border: `1px solid ${selectedPallet ? "rgba(245,158,11,0.35)" : "var(--border)"}`,
                    width: selectedPallet ? "220px" : "auto",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  {selectedPallet ? (
                    /* ── Pallet detail card ── */
                    <div>
                      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid rgba(245,158,11,0.2)" }}>
                        <div>
                          <span className="font-semibold" style={{ color: "#F59E0B" }}>
                            שורה {selectedPallet.row + 1} · עמודה {selectedPallet.col === 0 ? "שמאל" : "ימין"}
                          </span>
                          <span className="mr-2" style={{ color: "#50507A" }}>
                            ({selectedPallet.totalPackages} אריזות)
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedPallet(null)}
                          className="w-5 h-5 flex items-center justify-center rounded transition-opacity hover:opacity-70"
                          style={{ color: "#50507A" }}
                        >×</button>
                      </div>
                      <div className="p-2 space-y-1.5">
                        {selectedPallet.customers.map((c, i) => {
                          const color = colorMap.get(c.custName) ?? "#888";
                          const pct = Math.round((c.packages / selectedPallet.totalPackages) * 100);
                          return (
                            <div key={c.custName} className="rounded p-2" style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                                <span className="font-medium truncate" style={{ color: "#E8E8F8" }}>{c.cdes || c.custName}</span>
                                <span className="mr-auto text-xs" style={{ color: "#50507A" }}>#{i + 1}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                                </div>
                                <span style={{ color: "#10B981" }}>{c.packages} אר'</span>
                                <span style={{ color: "#F59E0B" }}>עצ' {c.stopOrder}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* ── Loading order legend ── */
                    <div className="px-3 py-2">
                      <div className="font-semibold mb-1.5" style={{ color: "#A0A0C0" }}>סדר העמסה</div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-3 h-1 rounded" style={{ background: "#F59E0B" }} />
                        <span style={{ color: "#50507A" }}>פתח אחורי ← עצירה 1</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-1 rounded" style={{ background: "#3B82F6" }} />
                        <span style={{ color: "#50507A" }}>עצירה אחרונה → קדמת משאית</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Hover tooltip */}
                {hoveredPallet && !selectedPallet && (
                  <div
                    className="fixed z-50 pointer-events-none text-xs rounded px-2.5 py-2"
                    style={{
                      left: hoverPos.x + 14,
                      top: hoverPos.y - 10,
                      background: "rgba(6,6,16,0.95)",
                      border: "1px solid rgba(245,158,11,0.3)",
                      backdropFilter: "blur(6px)",
                      maxWidth: "200px",
                    }}
                  >
                    <div className="font-semibold mb-1" style={{ color: "#F59E0B" }}>
                      שורה {hoveredPallet.row + 1} · {hoveredPallet.totalPackages} אריזות
                    </div>
                    {hoveredPallet.customers.map((c) => (
                      <div key={c.custName} className="flex items-center gap-1.5 mt-0.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorMap.get(c.custName) ?? "#888" }} />
                        <span className="truncate" style={{ color: "#C0C0D8" }}>{c.cdes || c.custName}</span>
                        <span className="mr-auto" style={{ color: "#10B981" }}>{c.packages}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Overflow / multi-truck notice */}
                {allTrucks && allTrucks.trucks.length > 1 && (
                  <div
                    className="absolute bottom-3 right-3 text-xs px-3 py-1.5 rounded pointer-events-none"
                    style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)", color: "#60A5FA" }}
                  >
                    משאית {selectedTruck + 1} מתוך {allTrucks.trucks.length} · {currentTruck?.pallets.length ?? 0}/10 משטחים
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Stop List View ── */}
          {activeTab === "stops" && (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="max-w-3xl mx-auto space-y-3">
                {sortedStops.map(([stop, stopOrders]) => {
                  const custName = stopOrders[0]?.CUSTNAME ?? "";
                  const color = colorMap.get(custName) ?? "#888";
                  const totalPkg = stopOrders.reduce((s, o) => s + Math.max(o.ZANA_ORDPLASQUANT, 0), 0);
                  const line = stopOrders[0]?.DISTRLINEDES ?? "";

                  return (
                    <div
                      key={stop}
                      className="p-4 rounded-lg"
                      style={{ background: "var(--surface)", border: `1px solid ${color}33` }}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ background: `${color}22`, border: `2px solid ${color}`, color }}
                        >
                          {stop || "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm" style={{ color: "#E8E8F8" }}>
                            {stopOrders[0]?.CDES || custName}
                          </div>
                          {line && <div className="text-xs mt-0.5" style={{ color: "#50507A" }}>קו: {line}</div>}
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-medium" style={{ color: "#10B981" }}>{totalPkg} אריזות</div>
                          <div className="text-xs" style={{ color: "#50507A" }}>{stopOrders.length} הזמנות</div>
                        </div>
                      </div>

                      <div className="space-y-1">
                        {stopOrders.map((o) => (
                          <div
                            key={o.ORDNAME}
                            className="flex items-center gap-3 px-3 py-1.5 rounded text-xs"
                            style={{ background: "rgba(255,255,255,0.025)" }}
                          >
                            <span style={{ color: "#F59E0B", fontFamily: "JetBrains Mono, monospace" }}>{o.ORDNAME}</span>
                            <span className="flex-1" style={{ color: "#A0A0C0" }}>{o.CDES}</span>
                            <span style={{ color: "#10B981" }}>{o.ZANA_ORDPLASQUANT} אר'</span>
                            <span style={{ color: "#50507A" }}>₪{o.TOTPRICE?.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Map Modal ── */}
      {showMap && mapStops.length > 0 && (
        <MapModal stops={mapStops} onClose={() => setShowMap(false)} />
      )}
    </div>
  );
}
