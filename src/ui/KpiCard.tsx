type KpiCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
};

export function KpiCard({ label, value, sub, onMouseEnter, onMouseLeave }: KpiCardProps) {
  return (
    <div className="kpi-card" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {sub && <span className="kpi-sub">{sub}</span>}
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
