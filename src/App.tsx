import { useState } from "react";
import { SimulationControls } from "./ui/SimulationControls";
import { WorldView } from "./ui/WorldView";
import { AgentPanel } from "./ui/AgentPanel";
import { EventLog } from "./ui/EventLog";
import { ConfigPanel } from "./ui/ConfigPanel";
import { LLMSettingsPanel } from "./ui/LLMSettingsPanel";
import { MetricsPanel } from "./ui/MetricsPanel";

type LeftTab = "metrics" | "world" | "minds";

export function App() {
  const [tab, setTab] = useState<LeftTab>("metrics");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 8, gap: 8 }}>
      <SimulationControls />

      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0 }}>
        {/* Left: metrics / config / llm */}
        <div style={{ width: 320, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="row" style={{ gap: 4, marginBottom: 8 }}>
            {(["metrics", "world", "minds"] as LeftTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  textTransform: "capitalize",
                  borderColor: tab === t ? "var(--accent)" : undefined,
                  color: tab === t ? "var(--accent)" : undefined,
                }}
              >
                {t === "world" ? "Config" : t === "minds" ? "LLM" : "Metrics"}
              </button>
            ))}
          </div>
          <div
            data-testid="left-panel-scroll"
            style={{ overflowY: "auto", overflowX: "hidden", flex: 1, minHeight: 0, paddingRight: 2 }}
          >
            {tab === "metrics" && <MetricsPanel />}
            {tab === "world" && <ConfigPanel />}
            {tab === "minds" && <LLMSettingsPanel />}
          </div>
        </div>

        {/* Center: world + event log */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, gap: 8 }}>
          <div className="panel" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <WorldView />
          </div>
          <div style={{ height: "32%", minHeight: 150, display: "flex" }}>
            <EventLog />
          </div>
        </div>

        {/* Right: agent inspector */}
        <div style={{ width: 350, overflowY: "auto", minHeight: 0, paddingRight: 2 }}>
          <AgentPanel />
        </div>
      </div>
    </div>
  );
}
