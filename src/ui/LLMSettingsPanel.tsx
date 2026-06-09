import { useStore } from "../state/store";
import type { LLMConfig, LLMProviderName, ReflectionMode } from "../types";
import { Field, Section } from "./widgets";

const PROVIDER_DEFAULTS: Record<LLMProviderName, Partial<LLMConfig>> = {
  ollama: { baseUrl: "http://localhost:11434", model: "qwen3:4b" },
  lmstudio: { baseUrl: "http://localhost:1234/v1", model: "local-model" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-6" },
  mock: { baseUrl: "", model: "deterministic" },
};

const MODES: { value: ReflectionMode; label: string }[] = [
  { value: "no_llm", label: "No LLM (rule-based only)" },
  { value: "major_events_only", label: "Major events + every N days (recommended)" },
  { value: "every_n_days", label: "Every N days" },
  { value: "individual_nightly", label: "Everyone nightly" },
  { value: "batch_nightly", label: "Everyone nightly (batched)" },
  { value: "hybrid_local_cloud", label: "Hybrid local + cloud" },
];

export function LLMSettingsPanel() {
  const tick = useStore((s) => s.tick);
  void tick;
  const cfg = useStore.getState().world.config.llm;
  const status = useStore((s) => s.llmStatus);
  const update = useStore.getState().updateLLMConfig;
  const testLLM = useStore.getState().testLLM;

  const setProvider = (p: LLMProviderName) => {
    update({ provider: p, ...PROVIDER_DEFAULTS[p] });
  };

  const needsKey = cfg.provider === "openai" || cfg.provider === "anthropic";

  return (
    <Section
      title="LLM (Agent Minds)"
      right={
        <span className="tag" style={{ borderColor: cfg.enabled ? "var(--good)" : undefined }}>
          {cfg.enabled ? cfg.provider : "off"}
        </span>
      }
    >
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <button
          onClick={() => update({ enabled: !cfg.enabled })}
          style={{ borderColor: cfg.enabled ? "var(--good)" : undefined, color: cfg.enabled ? "var(--good)" : undefined }}
        >
          {cfg.enabled ? "✓ LLM enabled" : "✕ LLM disabled"}
        </button>
        <button onClick={() => void testLLM()}>Test connection</button>
      </div>

      {status.lastTest && (
        <div
          style={{
            fontSize: 11,
            padding: "5px 8px",
            borderRadius: 5,
            marginBottom: 8,
            background: status.lastTest.ok ? "#16301d" : "#3a1d1d",
            color: status.lastTest.ok ? "var(--good)" : "var(--bad)",
          }}
        >
          {status.lastTest.ok ? "✓ " : "✕ "}
          {status.lastTest.detail}
        </div>
      )}

      <Field label="Provider">
        <select value={cfg.provider} onChange={(e) => setProvider(e.target.value as LLMProviderName)}>
          <option value="mock">Mock (deterministic)</option>
          <option value="ollama">Ollama (local)</option>
          <option value="lmstudio">LM Studio / OpenAI-compatible</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic (cloud)</option>
        </select>
      </Field>
      <Field label="Base URL">
        <input value={cfg.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} />
      </Field>
      <Field label="Model">
        <input value={cfg.model} onChange={(e) => update({ model: e.target.value })} />
      </Field>
      {needsKey && (
        <Field label="API key">
          <input
            type="password"
            value={cfg.apiKey ?? ""}
            placeholder="stored locally only"
            onChange={(e) => update({ apiKey: e.target.value })}
          />
        </Field>
      )}

      <Field label="Reflection mode">
        <select value={cfg.reflectionMode} onChange={(e) => update({ reflectionMode: e.target.value as ReflectionMode })}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reflect every N days">
        <input
          type="number"
          min={1}
          max={14}
          value={cfg.reflectEveryNDays}
          onChange={(e) => update({ reflectEveryNDays: Number(e.target.value) })}
        />
      </Field>
      <Field label="Max agents / night">
        <input
          type="number"
          min={1}
          max={30}
          value={cfg.maxAgentsPerBatch}
          onChange={(e) => update({ maxAgentsPerBatch: Number(e.target.value) })}
        />
      </Field>

      <div className="row" style={{ gap: 6, margin: "8px 0" }}>
        <button
          onClick={() => update({ useCloudForMajorEvents: !cfg.useCloudForMajorEvents })}
          style={{
            borderColor: cfg.useCloudForMajorEvents ? "var(--accent-2)" : undefined,
            color: cfg.useCloudForMajorEvents ? "var(--accent-2)" : undefined,
          }}
        >
          {cfg.useCloudForMajorEvents ? "✓ " : "✕ "}Cloud for major events
        </button>
      </div>
      {cfg.useCloudForMajorEvents && (
        <>
          <Field label="Cloud model">
            <input value={cfg.cloudModel ?? ""} onChange={(e) => update({ cloudModel: e.target.value })} />
          </Field>
          <Field label="Cloud API key">
            <input
              type="password"
              value={cfg.apiKey ?? ""}
              placeholder="Anthropic key"
              onChange={(e) => update({ apiKey: e.target.value })}
            />
          </Field>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
        <Field label="Temp">
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={cfg.temperature}
            onChange={(e) => update({ temperature: Number(e.target.value) })}
          />
        </Field>
        <Field label="Max tokens">
          <input
            type="number"
            min={128}
            max={6000}
            step={64}
            value={cfg.maxTokens}
            onChange={(e) => update({ maxTokens: Number(e.target.value) })}
          />
        </Field>
      </div>

      {cfg.provider === "ollama" && (
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <button
            onClick={() => update({ think: !cfg.think })}
            style={{ borderColor: cfg.think ? "var(--warn)" : undefined, color: cfg.think ? "var(--warn)" : undefined }}
          >
            {cfg.think ? "✓ " : "✕ "}Thinking mode (qwen3)
          </button>
          <span className="dim" style={{ fontSize: 10, flex: 1 }}>
            Off is recommended: faster & reliable JSON for reflection. If on, set Max tokens ≥ 2500.
          </span>
        </div>
      )}

      <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
        If the local model is unreachable, agents fall back to deterministic reflection and the sim keeps running.
        Ollama needs CORS: run with <span className="mono">OLLAMA_ORIGINS=*</span>.
      </div>

      {status.warnings.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="dim" style={{ fontSize: 11, cursor: "pointer" }}>
            Fallback log ({status.warnings.length})
          </summary>
          <div style={{ maxHeight: 90, overflowY: "auto", fontSize: 10 }} className="dim">
            {status.warnings.map((w, i) => (
              <div key={i}>· {w}</div>
            ))}
          </div>
        </details>
      )}
    </Section>
  );
}
