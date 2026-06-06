import React from "react";

/** A labeled 0..100 (or custom range) bar. */
export function Bar({
  label,
  value,
  min = 0,
  max = 100,
  color,
  warnHigh,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  color?: string;
  /** If true, high values are bad (red); otherwise high values are good (green). */
  warnHigh?: boolean;
}) {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  const clamped = Math.max(0, Math.min(100, pct));
  const c =
    color ??
    (warnHigh
      ? clamped > 66
        ? "var(--bad)"
        : clamped > 33
        ? "var(--warn)"
        : "var(--good)"
      : clamped > 66
      ? "var(--good)"
      : clamped > 33
      ? "var(--warn)"
      : "var(--bad)");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px 1fr 34px", gap: 6, alignItems: "center" }}>
      <span className="dim" style={{ fontSize: 11, textTransform: "capitalize" }}>
        {label}
      </span>
      <div className="bar">
        <span style={{ width: `${clamped}%`, background: c }} />
      </div>
      <span className="mono" style={{ fontSize: 11, textAlign: "right" }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{title}</span>
        {right}
      </div>
      <div style={{ padding: 10 }}>{children}</div>
    </div>
  );
}

export function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "2px 0" }}>
      <span className="dim">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 8, alignItems: "center", margin: "5px 0" }}>
      <span className="dim" style={{ fontSize: 11 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
