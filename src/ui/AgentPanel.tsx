import { useStore } from "../state/store";
import { TRAIT_GROUPS } from "../agents/traits";
import { SKILL_KEYS } from "../agents/skills";
import { NEED_KEYS } from "../agents/needs";
import { PRIORITY_KEYS } from "../agents/mind";
import { topMemories } from "../agents/memory";
import type { Agent } from "../types";
import { Bar, Section, StatRow } from "./widgets";

export function AgentPanel() {
  // Re-render on tick and selection changes.
  const tick = useStore((s) => s.tick);
  const selectedId = useStore((s) => s.selectedAgentId);
  const world = useStore.getState().world;
  void tick;

  const agent = selectedId ? world.agents[selectedId] : null;

  if (!agent) {
    return (
      <Section title="Agent Inspector">
        <div className="dim" style={{ fontSize: 12 }}>
          Click a villager on the map to inspect their mind, needs, relationships and memories.
        </div>
      </Section>
    );
  }

  const nameOf = (id: string) => world.agents[id]?.name ?? id;

  return (
    <div>
      <Section
        title="Agent Inspector"
        right={
          <span className="row" style={{ gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: agent.color }} />
            {!agent.alive && <span style={{ color: "var(--bad)" }}>deceased</span>}
          </span>
        }
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <strong style={{ fontSize: 15 }}>{agent.name}</strong>
          <span className="dim">
            {agent.gender ?? "—"} · age {Math.floor(agent.age)}
          </span>
        </div>
        <div className="dim" style={{ fontSize: 12, fontStyle: "italic", marginBottom: 8 }}>
          {agent.persona}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
          <StatRow label="Health" value={Math.round(agent.health)} />
          <StatRow label="Action" value={agent.currentAction ?? "—"} />
          <StatRow label="Position" value={`${agent.position.x},${agent.position.y}`} />
          <StatRow
            label="Target"
            value={agent.currentTargetAgentId ? nameOf(agent.currentTargetAgentId) : "—"}
          />
        </div>
        {!agent.alive && agent.causeOfDeath && (
          <div style={{ color: "var(--bad)", marginTop: 6, fontSize: 12 }}>
            Died on day {agent.deathDay}: {agent.causeOfDeath}.
          </div>
        )}
      </Section>

      <Section title="Needs">
        <div style={{ display: "grid", gap: 4 }}>
          {NEED_KEYS.map((k) => (
            <Bar key={k} label={k} value={agent.needs[k]} warnHigh />
          ))}
        </div>
      </Section>

      <Section title="Emotions">
        <div style={{ display: "grid", gap: 4 }}>
          {Object.entries(agent.mind.emotionalState).map(([k, v]) => (
            <Bar key={k} label={k} value={v as number} warnHigh={["anger", "fear", "grief", "shame", "loneliness"].includes(k)} />
          ))}
        </div>
      </Section>

      <Section title="Mind & Strategy">
        <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
          Current strategy
        </div>
        <div style={{ fontSize: 12, marginBottom: 8 }}>{agent.mind.currentStrategy}</div>
        {agent.mind.lastReflection && (
          <>
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
              Last reflection
            </div>
            <div style={{ fontSize: 12, fontStyle: "italic", marginBottom: 8 }}>“{agent.mind.lastReflection}”</div>
          </>
        )}
        {agent.mind.privateThoughts.length > 0 && (
          <>
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
              Private thoughts
            </div>
            {agent.mind.privateThoughts.slice(-4).map((t, i) => (
              <div key={i} style={{ fontSize: 12, color: "#b9a7e0", marginBottom: 2 }}>
                · {t}
              </div>
            ))}
          </>
        )}
      </Section>

      <Section title="Daily Priorities">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
          {PRIORITY_KEYS.map((k) => (
            <Bar key={k} label={k} value={agent.mind.dailyPriorities[k]} />
          ))}
        </div>
      </Section>

      <Section title="Beliefs & Goals">
        <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
          Beliefs
        </div>
        {agent.mind.beliefs.length === 0 && <div className="dim">—</div>}
        {agent.mind.beliefs.map((b, i) => (
          <div key={i} style={{ fontSize: 12, marginBottom: 2 }}>
            “{b.statement}” <span className="dim mono">({Math.round(b.confidence)}%)</span>
          </div>
        ))}
        <div className="dim" style={{ fontSize: 11, margin: "8px 0 4px" }}>
          Goals
        </div>
        {agent.mind.goals.filter((g) => g.status === "active").map((g, i) => (
          <div key={i} style={{ fontSize: 12, marginBottom: 2 }}>
            • {g.description} <span className="dim mono">({Math.round(g.priority)})</span>
          </div>
        ))}
      </Section>

      <Section title="Inventory & Skills">
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {Object.entries(agent.inventory).filter(([, v]) => (v ?? 0) > 0).length === 0 && (
            <span className="dim">empty</span>
          )}
          {Object.entries(agent.inventory)
            .filter(([, v]) => (v ?? 0) > 0)
            .map(([k, v]) => (
              <span key={k} className="tag">
                {k}: {Math.round(v as number)}
              </span>
            ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
          {SKILL_KEYS.filter((k) => agent.skills[k] > 12).map((k) => (
            <Bar key={k} label={k} value={agent.skills[k]} />
          ))}
        </div>
      </Section>

      <Section title="Traits">
        {TRAIT_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 8 }}>
            <div className="dim" style={{ fontSize: 10, textTransform: "uppercase", marginBottom: 3 }}>
              {group.label}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
              {group.keys.map((k) => (
                <Bar key={k} label={k} value={agent.traits[k]} color="#6f7bd6" />
              ))}
            </div>
          </div>
        ))}
      </Section>

      <RelationshipsSection agent={agent} nameOf={nameOf} />

      <Section title="Memories">
        {topMemories(agent, 8).map((m, i) => (
          <div key={i} style={{ fontSize: 12, marginBottom: 3 }}>
            <span className="mono dim">D{m.day}</span>{" "}
            <span style={{ color: memColor(m.type) }}>{m.description}</span>
          </div>
        ))}
        {agent.memories.length === 0 && <div className="dim">No memories yet.</div>}
      </Section>
    </div>
  );
}

function RelationshipsSection({ agent, nameOf }: { agent: Agent; nameOf: (id: string) => string }) {
  const entries = Object.entries(agent.relationships)
    .map(([id, r]) => ({ id, r }))
    .sort(
      (a, b) =>
        Math.abs(b.r.trust) + b.r.fear + b.r.resentment - (Math.abs(a.r.trust) + a.r.fear + a.r.resentment)
    )
    .slice(0, 8);
  return (
    <Section title="Relationships">
      {entries.length === 0 && <div className="dim">No relationships yet.</div>}
      {entries.map(({ id, r }) => (
        <div key={id} style={{ marginBottom: 6 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong style={{ fontSize: 12 }}>{nameOf(id)}</strong>
            <span className="mono dim" style={{ fontSize: 10 }}>
              {feeling(r)}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 10px" }}>
            <Bar label="trust" value={r.trust} min={-100} max={100} />
            <Bar label="affection" value={r.affection} min={-100} max={100} />
            <Bar label="fear" value={r.fear} warnHigh />
            <Bar label="resentment" value={r.resentment} warnHigh />
          </div>
        </div>
      ))}
    </Section>
  );
}

function feeling(r: { trust: number; affection: number; fear: number; resentment: number }): string {
  if (r.resentment > 55 || r.trust < -40) return "enemy";
  if (r.fear > 55) return "afraid";
  if (r.affection > 40 && r.trust > 30) return "close";
  if (r.trust > 20) return "friendly";
  return "wary";
}

function memColor(type: string): string {
  if (["trauma", "betrayal", "death", "conflict", "negative"].includes(type)) return "#f3a4a4";
  if (["kindness", "achievement", "positive", "birth"].includes(type)) return "#a4e3b0";
  return "#cdd6e0";
}
