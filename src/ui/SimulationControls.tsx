import { useStore } from "../state/store";
import { PRESET_NAMES } from "../config/presets";
import { SEASON_LABEL, seasonForDay } from "../simulation/seasons";
import type { WorldPresetName } from "../types";

const SPEEDS = [1, 2, 4, 8, 16, 40];

export function SimulationControls() {
  const running = useStore((s) => s.running);
  const speed = useStore((s) => s.speed);
  const preset = useStore((s) => s.preset);
  const reflecting = useStore((s) => s.llmStatus.reflecting);
  const progress = useStore((s) => s.llmStatus.progress);
  // Subscribe to tick so day/time refresh.
  const tick = useStore((s) => s.tick);
  const world = useStore.getState().world;

  const { start, pause, stepOnce, reset, setSpeed, setPreset } = useStore.getState();

  const timeLabel = world.timeOfDay >= 0.78 ? "Night" : "Day";

  return (
    <div
      className="panel"
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", flexWrap: "wrap" }}
      data-tick={tick}
    >
      <strong style={{ fontSize: 15, letterSpacing: 0.3 }}>AgentTown</strong>

      <div className="row" style={{ gap: 6 }}>
        {!running ? (
          <button className="primary" onClick={start}>
            ▶ Run
          </button>
        ) : (
          <button onClick={pause}>⏸ Pause</button>
        )}
        <button onClick={stepOnce} disabled={running}>
          ⏭ Step
        </button>
        <button className="danger" onClick={() => reset(false)} title="Restart with same seed">
          ↺ Reset
        </button>
        <button onClick={() => reset(true)} title="Restart with a new random seed">
          🎲 New
        </button>
      </div>

      <div className="row" style={{ gap: 4 }}>
        <span className="dim">Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              padding: "3px 7px",
              borderColor: speed === s ? "var(--accent)" : undefined,
              color: speed === s ? "var(--accent)" : undefined,
            }}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <span className="dim">World</span>
        <select value={preset} onChange={(e) => setPreset(e.target.value as WorldPresetName)}>
          {PRESET_NAMES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginLeft: "auto" }} className="row">
        <span className="tag">
          Day {world.day} · {timeLabel}
        </span>
        {world.config.seasonsEnabled && (
          <span className="tag">{SEASON_LABEL[seasonForDay(world.day)]}</span>
        )}
        <span className="tag">{useStore.getState().metrics.population} alive</span>
        {reflecting && (
          <span className="tag" style={{ borderColor: "var(--accent-2)", color: "var(--accent-2)" }}>
            🧠 reflecting {progress ? `${progress.done}/${progress.total}` : "…"}
            {progress?.lastName ? ` · ${progress.lastName}` : ""} — sim paused
          </span>
        )}
      </div>
    </div>
  );
}
