type KpiCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  compare?: { current: number; previous: number } | null;
  loading?: boolean;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
};

function pctChangeText(cur: number, prev: number) {
  if (!prev || prev === 0) return null;
  const diff = ((cur - prev) / prev) * 100;
  return { text: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`, dir: diff >= 0 ? "up" : "down" };
}

export function KpiCard({ label, value, sub, compare, loading, onMouseEnter, onMouseLeave }: KpiCardProps) {
  const comp = compare && compare.previous ? pctChangeText(compare.current, compare.previous) : null;
  return (
    <div className="kpi-card" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{loading ? "..." : value}</strong>
      {sub && <span className="kpi-sub">{sub}</span>}
      {comp && (
        <span className={`kpi-compare ${comp.dir}`}>
          {comp.dir === "up" ? "\u25B2" : "\u25BC"} {comp.text} <span className="sub">vs per\u00EDodo anterior</span>
        </span>
      )}
    </div>
  );
}

type KpiHeroProps = {
  label: string;
  value: string;
  margin?: number;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
};

export function KpiHero({ label, value, margin, onMouseEnter, onMouseLeave }: KpiHeroProps) {
  const positive = (margin ?? 0) >= 0;
  return (
    <div className={`kpi-hero${positive ? "" : " negative"}`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value kpi-hero-value">{value}</strong>
      <span className="kpi-hero-margin">Margem: {(margin ?? 0).toFixed(1)}%</span>
    </div>
  );
}
