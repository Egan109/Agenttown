import { useStore } from "../state/store";
import { Bar, Section, StatRow } from "./widgets";

export function MetricsPanel() {
  const m = useStore((s) => s.metrics);

  return (
    <Section title="Village Metrics">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px" }}>
        <StatRow label="Population" value={m.population} />
        <StatRow label="Shelters" value={m.shelters} />
        <StatRow label="Total births" value={m.births} />
        <StatRow label="Total deaths" value={m.deaths} />
        <StatRow label="Factions" value={m.factions} />
        <StatRow label="Avg trust" value={m.avgTrust.toFixed(0)} />
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 5 }}>
        <Bar label="Avg hunger" value={m.avgHunger} warnHigh />
        <Bar label="Avg thirst" value={m.avgThirst} warnHigh />
        <Bar label="Inequality" value={m.resourceInequality * 100} warnHigh />
        <Bar label="Violence" value={Math.min(100, m.violenceRate * 100)} warnHigh />
        <Bar label="Cooperation" value={m.cooperationScore} />
        <Bar label="Collapse risk" value={m.collapseRisk} warnHigh />
        <Bar label="Utopia score" value={m.utopiaScore} />
      </div>
    </Section>
  );
}
