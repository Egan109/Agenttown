import { useRef } from "react";
import { useStore } from "../state/store";
import type { SimulationConfig } from "../types";
import { Field, Section } from "./widgets";

function Num({
  k,
  min,
  max,
  step = 1,
}: {
  k: keyof SimulationConfig;
  min: number;
  max: number;
  step?: number;
}) {
  const tick = useStore((s) => s.tick);
  void tick;
  const cfg = useStore.getState().world.config;
  const update = useStore.getState().updateConfig;
  const value = cfg[k] as number;
  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ flex: 1 }}
        onChange={(e) => update({ [k]: Number(e.target.value) } as Partial<SimulationConfig>)}
      />
      <span className="mono" style={{ width: 38, textAlign: "right", fontSize: 11 }}>
        {typeof value === "number" && step < 1 ? value.toFixed(2) : value}
      </span>
    </div>
  );
}

function Toggle({ k, label }: { k: keyof SimulationConfig; label: string }) {
  const tick = useStore((s) => s.tick);
  void tick;
  const cfg = useStore.getState().world.config;
  const update = useStore.getState().updateConfig;
  const value = cfg[k] as boolean;
  return (
    <button
      onClick={() => update({ [k]: !value } as Partial<SimulationConfig>)}
      style={{
        padding: "3px 8px",
        fontSize: 11,
        borderColor: value ? "var(--good)" : undefined,
        color: value ? "var(--good)" : "var(--text-dim)",
      }}
    >
      {value ? "✓ " : "✕ "}
      {label}
    </button>
  );
}

export function ConfigPanel() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onExport = () => {
    const json = useStore.getState().exportConfig();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agenttown-config.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const onImport = (file: File) => {
    file.text().then((txt) => {
      if (!useStore.getState().importConfig(txt)) {
        alert("Could not parse config file.");
      }
    });
  };

  return (
    <Section
      title="Simulation Config"
      right={
        <span className="row" style={{ gap: 6 }}>
          <button style={{ padding: "1px 6px", fontSize: 10 }} onClick={onExport}>
            Export
          </button>
          <button style={{ padding: "1px 6px", fontSize: 10 }} onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
        </span>
      }
    >
      <div className="dim" style={{ fontSize: 10, marginBottom: 6 }}>
        Changing world size, population or resources rebuilds the world.
      </div>

      <Field label="World width">
        <Num k="worldWidth" min={12} max={48} />
      </Field>
      <Field label="World height">
        <Num k="worldHeight" min={10} max={36} />
      </Field>
      <Field label="Starting agents">
        <Num k="startingAgentCount" min={2} max={16} />
      </Field>
      <Field label="Max agents">
        <Num k="maxAgents" min={8} max={120} />
      </Field>
      <Field label="Resource abundance">
        <Num k="resourceScarcity" min={0.1} max={1} step={0.05} />
      </Field>
      <Field label="Regen rate">
        <Num k="resourceRegenerationRate" min={0.1} max={3} step={0.1} />
      </Field>

      <div className="dim" style={{ fontSize: 10, margin: "8px 0 2px" }}>
        NEED DECAY (per day)
      </div>
      <Field label="Hunger">
        <Num k="hungerRate" min={2} max={40} />
      </Field>
      <Field label="Thirst">
        <Num k="thirstRate" min={2} max={40} />
      </Field>
      <Field label="Energy">
        <Num k="energyDecayRate" min={2} max={40} />
      </Field>
      <Field label="Hygiene">
        <Num k="hygieneDecayRate" min={2} max={30} />
      </Field>
      <Field label="Social">
        <Num k="socialDecayRate" min={2} max={30} />
      </Field>

      <div className="dim" style={{ fontSize: 10, margin: "8px 0 2px" }}>
        GENETICS
      </div>
      <Field label="Mutation rate">
        <Num k="mutationRate" min={0} max={1} step={0.05} />
      </Field>
      <Field label="Inheritance">
        <Num k="childInheritanceStrength" min={0} max={1} step={0.05} />
      </Field>

      <div className="dim" style={{ fontSize: 10, margin: "10px 0 4px" }}>
        SYSTEMS
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 5 }}>
        <Toggle k="reproductionEnabled" label="Reproduction" />
        <Toggle k="conflictEnabled" label="Conflict" />
        <Toggle k="violenceEnabled" label="Violence" />
        <Toggle k="stealingEnabled" label="Stealing" />
        <Toggle k="tradingEnabled" label="Trading" />
        <Toggle k="diplomacyEnabled" label="Diplomacy" />
      </div>
    </Section>
  );
}
