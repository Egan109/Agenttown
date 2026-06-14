import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import type { WorldEvent } from "../types";
import { ChronicleFeed } from "./DailyChroniclePanel";

const SEVERITY_COLOR = ["#6b7686", "#a9b4c2", "#fbbf24", "#f87171"];

// `summary` is special-cased: it renders the village chronicle (narrator output)
// from world.dailySummaries instead of plain event lines.
const FILTERS: { label: string; types: WorldEvent["type"][] | null }[] = [
  { label: "All", types: null },
  { label: "Drama", types: ["attack", "theft", "betrayal", "death", "birth", "rescue"] },
  { label: "Social", types: ["share", "trade", "alliance", "group_formed", "message", "heal"] },
  { label: "Minds", types: ["reflection"] },
  { label: "Summary", types: ["chronicle"] },
];

const SUMMARY_FILTER = FILTERS.findIndex((f) => f.label === "Summary");

export function EventLog() {
  // Re-render only when the event count changes (not every tick), so rendering a
  // long history doesn't churn 8×/second.
  const eventCount = useStore((s) => s.world.events.length);
  const [filter, setFilter] = useState(0);
  const events = useStore.getState().world.events;

  const shown = useMemo(() => {
    const f = FILTERS[filter];
    const list = f.types ? events.filter((e) => f.types!.includes(e.type)) : events;
    // Filtered views (Drama/Social/Minds) are low-volume — show the whole run.
    // The unfiltered "All" view is capped just to bound the DOM size.
    const limited = f.types ? list : list.slice(-1500);
    return limited.slice().reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCount, filter, events]);

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Event Log</span>
        <div className="row" style={{ gap: 4 }}>
          {FILTERS.map((f, i) => (
            <button
              key={f.label}
              onClick={() => setFilter(i)}
              style={{
                padding: "2px 6px",
                fontSize: 10,
                borderColor: filter === i ? "var(--accent)" : undefined,
                color: filter === i ? "var(--accent)" : undefined,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowY: "auto", padding: "6px 10px", flex: 1, minHeight: 0 }}>
        {filter === SUMMARY_FILTER && <ChronicleFeed />}
        {filter !== SUMMARY_FILTER && shown.length === 0 && (
          <div className="dim">No events yet. Press Run.</div>
        )}
        {filter !== SUMMARY_FILTER &&
          shown.map((e) => (
          <div key={e.id} style={{ padding: "3px 0", borderBottom: "1px solid #1b2027", fontSize: 12 }}>
            <span className="mono dim" style={{ marginRight: 8 }}>
              Day {e.day} ·
            </span>
            <span
              style={{
                color:
                  e.type === "reflection" || e.type === "chronicle"
                    ? "#b9a7e0"
                    : SEVERITY_COLOR[e.severity],
              }}
            >
              {e.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
