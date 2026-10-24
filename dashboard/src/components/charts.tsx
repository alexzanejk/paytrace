import { tk } from "@/lib/format";

/** Small charts drawn as plain SVG, so no chart library is needed. Colours come from the theme (CSS variables) so light and dark both work. */

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** A ring split by share, with the total in the middle and a legend that reads like a table. */
export function Donut({ slices, centre }: { slices: Slice[]; centre: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`Share by wallet: ${slices.map((s) => `${s.label} ${pct(s.value, total)}`).join(", ")}`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-muted)" strokeWidth="16" />
        {total > 0
          ? slices
              .filter((s) => s.value > 0)
              .map((s) => {
                const len = (s.value / total) * C;
                const el = (
                  <circle
                    key={s.label}
                    cx="70"
                    cy="70"
                    r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="16"
                    strokeDasharray={`${Math.max(len - 2, 0.5)} ${C}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 70 70)"
                  >
                    <title>{`${s.label}: ${tk(s.value)} (${pct(s.value, total)})`}</title>
                  </circle>
                );
                offset += len;
                return el;
              })
          : null}
        <text x="70" y="66" textAnchor="middle" className="fill-muted-foreground" fontSize="9">Total</text>
        <text x="70" y="82" textAnchor="middle" className="fill-foreground" fontSize="12" fontWeight="600">{centre}</text>
      </svg>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="tabular font-medium">{pct(s.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const pct = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "0%");

export interface DayBar {
  key: string;
  label: string;
  a: number;
  b: number;
}

/** One column per day, two stacked parts: [aLabel] in blue and [bLabel] in green. Hover (or long-press) a column for exact figures. */
export function DayBars({ days, aLabel, bLabel }: { days: DayBar[]; aLabel: string; bLabel: string }) {
  const W = 640;
  const H = 210;
  const left = 8;
  const right = 56;
  const top = 10;
  const bottom = 26;
  const max = Math.max(1, ...days.map((d) => d.a + d.b));
  const top$ = niceMax(max);
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const slot = plotW / Math.max(days.length, 1);
  const barW = Math.min(34, Math.max(3, slot * 0.62));
  const y = (v: number) => top + plotH - (v / top$) * plotH;
  const every = Math.ceil(days.length / 8);
  const ticks = [0, top$ / 2, top$];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${aLabel} and ${bLabel} for each day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={W - right + 8} y={y(t) + 3} fontSize="10" className="fill-muted-foreground">{short(t)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = left + slot * i + (slot - barW) / 2;
          const hb = (d.b / top$) * plotH;
          const ha = (d.a / top$) * plotH;
          return (
            <g key={d.key}>
              <rect x={x} y={y(d.a + d.b)} width={barW} height={ha} rx={Math.min(5, barW / 2)} fill="var(--color-tile-blue)" />
              <rect x={x} y={y(d.b) + 0} width={barW} height={hb} rx={Math.min(5, barW / 2)} fill="var(--color-tile-green)" />
              <rect x={left + slot * i} y={top} width={slot} height={plotH} fill="transparent">
                <title>{`${d.label}\n${aLabel}: ${tk(d.a)}\n${bLabel}: ${tk(d.b)}`}</title>
              </rect>
              {i % every === 0 ? (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="10" className="fill-muted-foreground">{d.label}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-tile-blue" />{aLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-tile-green" />{bLabel}</span>
      </div>
    </div>
  );
}

/** Rounds a top value up to a tidy number so the grid lines read well (e.g. 7,300 becomes 8,000). */
export function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

/** 1,200 -> 1.2k, 3,400,000 -> 3.4M */
export function short(v: number): string {
  if (v >= 1_000_000) return `${trim(v / 1_000_000)}M`;
  if (v >= 1_000) return `${trim(v / 1_000)}k`;
  return String(Math.round(v));
}
const trim = (n: number) => String(Math.round(n * 10) / 10);
