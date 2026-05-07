"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapStop } from "./types";

interface GeoStop extends MapStop {
  address: string;
  city: string;
  latlng: [number, number] | null;
  fromGps: boolean;
}

interface MapModalProps {
  stops: MapStop[];
  onClose: () => void;
}

const STOP_COLORS = [
  "var(--accent)", "#3B82F6", "var(--success)", "var(--danger)", "#8B5CF6",
  "#F97316", "var(--cyan)", "#84CC16", "#EC4899", "#14B8A6",
  "#A78BFA", "#FB7185", "#34D399", "#FBBF24", "#60A5FA",
];

function makeNumberedIcon(num: number, color: string) {
  return L.divIcon({
    html: `<div style="background:${color};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:11px;border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 6px rgba(0,0,0,0.4)">${num}</div>`,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

async function geocode(query: string): Promise<[number, number] | null> {
  if (!query || query.trim().length < 3) return null;
  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(query + ", ישראל")}` +
      `&countrycodes=il&format=json&limit=1&accept-language=he`;
    const r = await fetch(url, {
      headers: { "User-Agent": "PriorityERP-DistributionPlanner/1.0" },
    });
    const data = await r.json();
    if (data.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch {}
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function MapModal({ stops, onClose }: MapModalProps) {
  const [geoStops, setGeoStops] = useState<GeoStop[]>([]);
  const [phase, setPhase] = useState<"addresses" | "geocoding" | "done">("addresses");
  const [progress, setProgress] = useState({ current: 0, total: stops.length });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // 1. Fetch ERP addresses (includes GPS coords + city)
      const custNames = stops.map((s) => s.custName).join(",");

      interface AddressRecord {
        custName: string;
        address: string;
        city: string;
        zip: string;
        gpsx: number | null;
        gpsy: number | null;
      }
      const addrMap = new Map<string, AddressRecord>();

      try {
        const r = await fetch(`/api/distribution/addresses?customers=${encodeURIComponent(custNames)}`);
        if (r.ok) {
          const json = await r.json();
          for (const a of json.addresses ?? []) {
            if (a.custName) addrMap.set(a.custName, a as AddressRecord);
          }
        }
      } catch {}

      if (cancelled) return;

      // 2. Resolve coordinates — use GPS directly when available, geocode otherwise
      const gpsReady: GeoStop[] = [];
      const needsGeocode: { stop: MapStop; rec: AddressRecord | undefined; idx: number }[] = [];

      stops.forEach((s, idx) => {
        const rec = addrMap.get(s.custName);
        if (rec?.gpsy && rec?.gpsx) {
          // Priority stores GPSX=longitude, GPSY=latitude
          gpsReady.push({
            ...s, address: rec.address, city: rec.city,
            latlng: [rec.gpsy, rec.gpsx], fromGps: true,
          });
        } else {
          needsGeocode.push({ stop: s, rec, idx });
        }
      });

      // Show GPS-resolved stops immediately
      if (gpsReady.length > 0) {
        setGeoStops(gpsReady);
      }

      if (needsGeocode.length === 0) {
        if (!cancelled) setPhase("done");
        return;
      }

      setPhase("geocoding");
      setProgress({ current: 0, total: needsGeocode.length });

      // 3. Geocode remaining stops (Nominatim rate limit: 1 req/sec)
      const geocoded: GeoStop[] = [...gpsReady];

      for (let i = 0; i < needsGeocode.length; i++) {
        if (cancelled) return;
        const { stop, rec } = needsGeocode[i];
        const address = rec?.address ?? "";
        const city = rec?.city ?? "";

        // Build best possible query: street + city, or customer name as last resort
        let query = "";
        if (address && city) query = `${address}, ${city}`;
        else if (address) query = address;
        else if (city) query = city;
        else query = stop.cdes || stop.custName;

        const latlng = await geocode(query);
        const geoStop: GeoStop = { ...stop, address, city, latlng, fromGps: false };
        geocoded.push(geoStop);

        // Re-sort by stopOrder and update state
        setGeoStops([...geocoded].sort((a, b) => a.stopOrder - b.stopOrder));
        setProgress({ current: i + 1, total: needsGeocode.length });

        if (i < needsGeocode.length - 1) await sleep(1100);
      }

      if (!cancelled) setPhase("done");
    }

    run();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mappedStops = geoStops.filter((s) => s.latlng !== null);
  const polyline = mappedStops.map((s) => s.latlng as [number, number]);

  const center: [number, number] =
    mappedStops.length > 0
      ? [
          mappedStops.reduce((s, p) => s + p.latlng![0], 0) / mappedStops.length,
          mappedStops.reduce((s, p) => s + p.latlng![1], 0) / mappedStops.length,
        ]
      : [31.7683, 35.2137];

  const mapKey = `map-${phase === "done" ? "done" : "loading"}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--overlay-bg-modal)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-5xl rounded-xl overflow-hidden flex"
        style={{
          height: "85vh",
          background: "var(--bg-canvas)",
          border: "1px solid rgba(245,158,11,0.3)",
        }}
      >
        {/* ── Sidebar ── */}
        <div
          className="w-72 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderLeft: "1px solid var(--border)", direction: "rtl" }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
          >
            <div>
              <div className="font-bold text-sm" style={{ color: "var(--text-high)" }}>מסלול הפצה</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {stops.length} עצירות
                {phase !== "addresses" && ` · ${mappedStops.length} מוצגות במפה`}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded transition-opacity hover:opacity-70"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              ×
            </button>
          </div>

          {/* Progress bar */}
          {phase !== "done" && (
            <div className="px-4 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex justify-between text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                <span>{phase === "addresses" ? "טוען כתובות..." : `מקודד (${progress.current}/${progress.total})`}</span>
                <span style={{ color: "var(--accent)" }}>{Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--hover-overlay-4)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {geoStops.map((s, i) => {
              const color = STOP_COLORS[i % STOP_COLORS.length];
              return (
                <div
                  key={s.stopOrder}
                  className="p-2.5 rounded-lg text-xs"
                  style={{
                    background: "var(--surface)",
                    border: `1px solid ${s.latlng ? color + "44" : "var(--hover-overlay-2)"}`,
                    opacity: s.latlng ? 1 : 0.55,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: s.latlng ? color : "#333", color: "#fff" }}
                    >
                      {s.stopOrder}
                    </div>
                    <span className="font-medium truncate" style={{ color: "var(--text-high)" }}>
                      {s.cdes || s.custName}
                    </span>
                  </div>
                  {(s.address || s.city) ? (
                    <div className="text-xs mb-1 mr-7 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {[s.address, s.city].filter(Boolean).join(", ")}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-3 mr-7 flex-wrap">
                    <span style={{ color: "var(--success)" }}>{s.packages} אריזות</span>
                    <span style={{ color: "var(--text-muted)" }}>{s.ordCount} הזמנות</span>
                    {s.latlng && s.fromGps && (
                      <span style={{ color: "var(--cyan)", fontSize: "10px" }}>📍 GPS</span>
                    )}
                    {!s.latlng && (
                      <span style={{ color: "var(--danger)", fontSize: "10px" }}>לא נמצא</span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Pending stops (not yet geocoded) */}
            {stops.slice(geoStops.length).map((s, i) => (
              <div
                key={s.stopOrder}
                className="p-2.5 rounded-lg text-xs"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--hover-overlay-soft)",
                  opacity: 0.3,
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: "#333", color: "#fff" }}
                  >
                    {s.stopOrder}
                  </div>
                  <span style={{ color: "var(--text-high)" }}>{s.cdes || s.custName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Map ── */}
        <div className="flex-1 relative">
          <MapContainer
            key={mapKey}
            center={center}
            zoom={mappedStops.length > 1 ? 10 : 12}
            style={{ width: "100%", height: "100%" }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            {polyline.length > 1 && (
              <Polyline
                positions={polyline}
                color="var(--accent)"
                weight={2.5}
                opacity={0.75}
                dashArray="7 5"
              />
            )}
            {geoStops
              .filter((s) => s.latlng)
              .map((s, i) => {
                const color = STOP_COLORS[i % STOP_COLORS.length];
                return (
                  <Marker
                    key={s.stopOrder}
                    position={s.latlng!}
                    icon={makeNumberedIcon(s.stopOrder, color)}
                  >
                    <Popup>
                      <div style={{ direction: "rtl", fontFamily: "Arial, sans-serif", minWidth: "160px" }}>
                        <div style={{ fontWeight: "bold", marginBottom: "4px", fontSize: "13px" }}>
                          עצירה {s.stopOrder}: {s.cdes || s.custName}
                        </div>
                        {(s.address || s.city) && (
                          <div style={{ color: "#555", fontSize: "11px", marginBottom: "4px" }}>
                            {[s.address, s.city].filter(Boolean).join(", ")}
                          </div>
                        )}
                        <div style={{ color: "#059669", fontSize: "12px" }}>{s.packages} אריזות · {s.ordCount} הזמנות</div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
          </MapContainer>

          {phase === "addresses" && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none"
              style={{ background: "var(--overlay-bg)", color: "var(--text-muted)" }}
            >
              <div className="text-4xl">🗺</div>
              <div className="text-sm">טוען כתובות מה-ERP...</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
