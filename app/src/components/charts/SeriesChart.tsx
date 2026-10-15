import { useEffect, useMemo, useRef, useState } from "react";

export interface ChartSeries { name: string; color: string; values: (number | null)[]; dash?: boolean; width?: number }
export interface ChartBand { name: string; lower: (number | null)[]; upper: (number | null)[]; color: string; opacity?: number }

interface Props {
  dates: string[];
  series: ChartSeries[];
  bands?: ChartBand[];
  height?: number;
  log?: boolean;
  format?: (v: number) => string;
  zeroLine?: boolean;
  /** Draw a vertical marker at this date (e.g. the start of a projection). */
  markerDate?: string;
  markerLabel?: string;
}

const PAD = { l: 58, r: 12, t: 10, b: 22 };

export function SeriesChart({ dates, series, bands = [], height = 220, log = false, format = (v) => v.toFixed(2), zeroLine, markerDate, markerLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const n = dates.length;
  const geo = useMemo(() => {
    const vals: number[] = [];
    const take = (a: (number | null)[]) => { for (const v of a) if (v != null && Number.isFinite(v) && (!log || v > 0)) vals.push(v); };
    series.forEach((s) => take(s.values));
    bands.forEach((b) => { take(b.lower); take(b.upper); });
    if (vals.length === 0 || n < 2) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const f = log ? Math.log : (x: number) => x;
    const a = f(lo), b = f(hi), span = b - a;
    const iw = w - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
    const x = (i: number) => PAD.l + (i / (n - 1)) * iw;
    const y = (v: number) => PAD.t + (1 - (f(v) - a) / span) * ih;
    const ticks = Array.from({ length: 5 }, (_, i) => {
      const t = a + (span * i) / 4;
      return log ? Math.exp(t) : t;
    });
    return { x, y, ticks, iw, ih, lo, hi };
  }, [series, bands, n, w, height, log, zeroLine]);

  if (!geo) return <div ref={wrap} className="text-term-muted text-[11px] p-3">Not enough data to chart.</div>;
  const { x, y, ticks } = geo;

  const step = Math.max(1, Math.floor(n / (w * 1.2)));
  const idxs: number[] = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);

  const linePath = (vals: (number | null)[]) => {
    let d = "", pen = false;
    for (const i of idxs) {
      const v = vals[i];
      if (v == null || !Number.isFinite(v) || (log && v <= 0)) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const bandPath = (b: ChartBand) => {
    const up: string[] = [], dn: string[] = [];
    for (const i of idxs) {
      const u = b.upper[i], l = b.lower[i];
      if (u == null || l == null) continue;
      up.push(`${x(i).toFixed(1)},${y(u).toFixed(1)}`);
      dn.push(`${x(i).toFixed(1)},${y(l).toFixed(1)}`);
    }
    return up.length ? `M${up.join("L")}L${dn.reverse().join("L")}Z` : "";
  };

  const xTicks = Array.from({ length: 6 }, (_, i) => Math.round((i / 5) * (n - 1)));
  const markerIdx = markerDate ? dates.findIndex((d) => d >= markerDate) : -1;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - PAD.l) / (w - PAD.l - PAD.r)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div ref={wrap} className="relative w-full select-none">
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="#222" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#6e6e6e">{format(t)}</text>
          </g>
        ))}
        {xTicks.map((i, k) => (
          <text key={k} x={x(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === xTicks.length - 1 ? "end" : "middle"} fontSize={10} fill="#6e6e6e">
            {dates[i]?.slice(0, 7)}
          </text>
        ))}
        {zeroLine && geo.lo < 0 && geo.hi > 0 && <line x1={PAD.l} x2={w - PAD.r} y1={y(0)} y2={y(0)} stroke="#444" strokeDasharray="3 3" />}
        {bands.map((b) => <path key={b.name} d={bandPath(b)} fill={b.color} opacity={b.opacity ?? 0.18} />)}
        {markerIdx > 0 && (
          <g>
            <line x1={x(markerIdx)} x2={x(markerIdx)} y1={PAD.t} y2={height - PAD.b} stroke="#ff8c00" strokeDasharray="4 3" opacity={0.7} />
            {markerLabel && <text x={x(markerIdx) + 4} y={PAD.t + 10} fontSize={10} fill="#ff8c00">{markerLabel}</text>}
          </g>
        )}
        {series.map((s) => (
          <path key={s.name} d={linePath(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.5} strokeDasharray={s.dash ? "5 4" : undefined} />
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} stroke="#ff8c00" opacity={0.5} />}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-1 text-[10px]">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-term-muted">
            <span className="inline-block w-3 h-[2px]" style={{ background: s.color }} />{s.name}
          </span>
        ))}
        {bands.map((b) => (
          <span key={b.name} className="flex items-center gap-1.5 text-term-muted">
            <span className="inline-block w-3 h-2" style={{ background: b.color, opacity: 0.4 }} />{b.name}
          </span>
        ))}
      </div>
      {hover != null && (
        <div className="absolute top-2 right-3 bg-term-panel2 border border-term-border px-2 py-1 text-[10px] pointer-events-none">
          <div className="text-term-amber">{dates[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex justify-between gap-4">
              <span style={{ color: s.color }}>{s.name}</span>
              <span className="num text-term-text">{s.values[hover] != null ? format(s.values[hover] as number) : "—"}</span>
            </div>
          ))}
          {bands.map((b) => (
            <div key={b.name} className="flex justify-between gap-4">
              <span className="text-term-muted">{b.name}</span>
              <span className="num text-term-text">
                {b.lower[hover] != null && b.upper[hover] != null ? `${format(b.lower[hover] as number)} – ${format(b.upper[hover] as number)}` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
