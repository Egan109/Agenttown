import { useStore } from "../state/store";
import type { DailySummary } from "../types";

/**
 * The "Summary" feed for the event-log screen: the village chronicle rendered as
 * narrator output — each day a short third-person story plus headline bullets.
 * Newest first. Used by EventLog when the "Summary" filter is active.
 */
export function ChronicleFeed() {
  // Re-read on every tick bump so freshly written chronicles appear live.
  useStore((s) => s.tick);
  const summaries = useStore.getState().world.dailySummaries;
  const ordered = [...summaries].reverse();

  if (ordered.length === 0) {
    return (
      <div className="dim" style={{ padding: 8, fontSize: 12 }}>
        No chronicles yet. Each dawn, after the villagers reflect, the narrator
        summarizes their day here. (Requires the LLM to be enabled.)
      </div>
    );
  }

  return (
    <>
      {ordered.map((s) => (
        <ChronicleCard key={s.day} summary={s} />
      ))}
    </>
  );
}

function ChronicleCard({ summary: s }: { summary: DailySummary }) {
  return (
    <div style={{ borderBottom: "1px solid #1b2027", padding: "8px 2px 10px" }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}
      >
        <strong style={{ fontSize: 13, color: "#b9a7e0" }}>📜 Day {s.day}</strong>
        <span className="mono dim" style={{ fontSize: 10 }}>
          {s.population}👥
          {s.births > 0 ? ` ·${s.births}🍼` : ""}
          {s.deaths > 0 ? ` ·${s.deaths}⚰️` : ""}
          {s.conflicts > 0 ? ` ·${s.conflicts}⚔️` : ""}
        </span>
      </div>

      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#dbe2ea", fontStyle: "italic" }}>
        {s.text}
      </div>

      {s.headlines.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
          {s.headlines.map((h, i) => (
            <li key={i} className="dim" style={{ fontSize: 11, lineHeight: 1.4 }}>
              {h}
            </li>
          ))}
        </ul>
      )}

      <div className="dim" style={{ fontSize: 9.5, marginTop: 5 }}>
        {s.reflectionCount} reflection{s.reflectionCount === 1 ? "" : "s"}
        {s.fellBack ? " · offline summary" : ""}
      </div>
    </div>
  );
}
