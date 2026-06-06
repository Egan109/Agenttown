import { getRelationship } from "../agents/relationships";
import { syncOpinionFromRelationship } from "../agents/mind";
import type {
  Agent,
  LLMConfig,
  LLMProvider,
  NightlyReflectionInput,
  NightlyReflectionOutput,
  SocialOpinion,
  WorldState,
  WorldSummary,
} from "../types";
import { clamp, clamp100, clampSigned } from "../util/math";
import { livingAgents, resourceDensity } from "../simulation/world";
import { logEvent } from "../simulation/events";
import { deterministicReflection } from "./mockProvider";

// ---------------------------------------------------------------------------
// Building reflection input
// ---------------------------------------------------------------------------

export function buildWorldSummary(world: WorldState): WorldSummary {
  const foodDensity = resourceDensity(world, "food");
  const hasWater = resourceDensity(world, "water") > 0;
  let dangerTiles = 0;
  let total = 0;
  for (const row of world.tiles)
    for (const t of row) {
      total++;
      if (t.terrain === "danger") dangerTiles++;
    }
  const pop = livingAgents(world).length;
  return {
    foodScarcity: clamp(1 - foodDensity / 30, 0, 1),
    waterScarcity: hasWater ? 0.1 : 0.85,
    dangerLevel: clamp(dangerTiles / Math.max(1, total) + world.conflictsToday / Math.max(1, pop), 0, 1),
    population: pop,
    deathsToday: world.deathsToday,
    birthsToday: world.birthsToday,
    conflictsToday: world.conflictsToday,
  };
}

function locationSummary(world: WorldState, agent: Agent): string {
  const tile = world.tiles[agent.position.y]?.[agent.position.x];
  const terrain = tile?.terrain ?? "unknown";
  const sheltered = tile?.shelterId ? "under a shelter" : "in the open";
  const near = livingAgents(world).filter(
    (o) =>
      o.id !== agent.id &&
      Math.max(Math.abs(o.position.x - agent.position.x), Math.abs(o.position.y - agent.position.y)) <= 4
  ).length;
  return `on ${terrain} terrain, ${sheltered}, with ${near} other(s) nearby`;
}

export function buildReflectionInput(world: WorldState, agent: Agent): NightlyReflectionInput {
  // Sync social opinions from the mechanical relationships so the model sees
  // the same numbers the rule engine uses, and collect names for the prompt.
  const relationships: Record<string, SocialOpinion> = {};
  const agentNames: Record<string, string> = {};
  const related = Object.keys(agent.relationships)
    .map((id) => ({ id, rel: agent.relationships[id] }))
    .filter(({ rel }) =>
      Math.abs(rel.trust) + Math.abs(rel.affection) + rel.fear + rel.resentment + rel.respect > 10
    )
    .sort(
      (a, b) =>
        Math.abs(b.rel.trust) + b.rel.fear + b.rel.resentment - (Math.abs(a.rel.trust) + a.rel.fear + a.rel.resentment)
    )
    .slice(0, 10);
  for (const { id } of related) {
    const other = world.agents[id];
    if (!other) continue;
    relationships[id] = syncOpinionFromRelationship(agent.mind, id, agent.relationships[id]);
    agentNames[id] = other.name;
  }

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      age: agent.age,
      gender: agent.gender,
      persona: agent.persona,
      traits: agent.traits,
      skills: agent.skills,
    },
    currentState: {
      needs: agent.needs,
      inventory: agent.inventory,
      health: agent.health,
      locationSummary: locationSummary(world, agent),
    },
    mind: agent.mind,
    relationships,
    agentNames,
    todaysEvents: world.dailyAgentEvents[agent.id] ?? [],
    worldSummary: buildWorldSummary(world),
  };
}

// ---------------------------------------------------------------------------
// Selecting who reflects tonight
// ---------------------------------------------------------------------------

/**
 * Decide which agents reflect at this dawn, per the configured mode. The list is
 * capped at maxAgentsPerBatch so a big village doesn't fire hundreds of (slow)
 * local LLM calls per night — pending major events come first, then the most
 * overdue agents.
 */
export function selectAgentsForReflection(world: WorldState): string[] {
  const cfg = world.config.llm;
  if (!cfg.enabled || cfg.reflectionMode === "no_llm") return [];
  const living = livingAgents(world);
  const everyN = Math.max(1, cfg.reflectEveryNDays);
  const overdue = (a: Agent) => world.day - a.lastReflectionDay >= everyN;

  let pool: Agent[];
  switch (cfg.reflectionMode) {
    case "individual_nightly":
    case "batch_nightly":
      pool = living;
      break;
    case "every_n_days":
      pool = living.filter(overdue);
      break;
    case "major_events_only":
    case "hybrid_local_cloud":
    default:
      // Recommended default: react to major events immediately, plus a periodic
      // catch-up for everyone else every N days.
      pool = living.filter((a) => a.pendingMajorEvent || overdue(a));
      break;
  }

  pool.sort((a, b) => {
    const am = a.pendingMajorEvent ? 1 : 0;
    const bm = b.pendingMajorEvent ? 1 : 0;
    if (am !== bm) return bm - am;
    return a.lastReflectionDay - b.lastReflectionDay;
  });
  return pool.slice(0, Math.max(1, cfg.maxAgentsPerBatch)).map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Applying reflection output (safely) to the agent's mind
// ---------------------------------------------------------------------------

const MAX_BELIEFS = 8;
const MAX_GOALS = 6;
const MAX_THOUGHTS = 8;
const MAX_REL_DELTA = 40; // clamp how far one night can move a relationship

export function applyReflection(world: WorldState, agent: Agent, out: NightlyReflectionOutput): void {
  const m = agent.mind;

  // Priorities (already clamped by schema, clamp again defensively).
  for (const k in out.dailyPriorities) {
    const key = k as keyof typeof m.dailyPriorities;
    m.dailyPriorities[key] = clamp100(out.dailyPriorities[key]);
  }

  // Emotions.
  for (const k in out.emotionalState) {
    const key = k as keyof typeof m.emotionalState;
    m.emotionalState[key] = clamp100(out.emotionalState[key]);
  }

  if (out.currentStrategy) m.currentStrategy = out.currentStrategy.slice(0, 240);

  // Beliefs: merge, dedupe by statement, keep the strongest.
  if (out.newBeliefs.length) {
    const seen = new Set(m.beliefs.map((b) => b.statement.toLowerCase()));
    for (const b of out.newBeliefs) {
      if (!b.statement || seen.has(b.statement.toLowerCase())) continue;
      m.beliefs.push({
        statement: b.statement.slice(0, 160),
        confidence: clamp100(b.confidence),
        emotionalWeight: clamp100(b.emotionalWeight),
      });
      seen.add(b.statement.toLowerCase());
    }
    m.beliefs.sort((a, b) => b.emotionalWeight - a.emotionalWeight);
    m.beliefs = m.beliefs.slice(0, MAX_BELIEFS);
  }

  // Goals: replace with the model's set if it provided any.
  if (out.updatedGoals.length) {
    m.goals = out.updatedGoals
      .filter((g) => g.description)
      .map((g) => ({
        description: g.description.slice(0, 160),
        priority: clamp100(g.priority),
        status: g.status,
      }))
      .slice(0, MAX_GOALS);
  }

  // Private thoughts: append, keep recent.
  if (out.privateThoughts.length) {
    m.privateThoughts.push(...out.privateThoughts.map((t) => t.slice(0, 200)));
    if (m.privateThoughts.length > MAX_THOUGHTS) {
      m.privateThoughts = m.privateThoughts.slice(-MAX_THOUGHTS);
    }
  }

  // Relationship updates: the bridge from "opinion" back into the mechanical
  // numbers the rule engine reads. Each delta is bounded so one reflection can
  // shade a relationship but not rewrite it.
  for (const u of out.relationshipUpdates) {
    if (!u.agentId || !world.agents[u.agentId]) continue;
    const rel = getRelationship(agent, u.agentId);
    const bd = (v?: number) => clamp(v ?? 0, -MAX_REL_DELTA, MAX_REL_DELTA);
    rel.trust = clampSigned(rel.trust + bd(u.trustDelta));
    rel.affection = clampSigned(rel.affection + bd(u.affectionDelta));
    rel.fear = clamp100(rel.fear + bd(u.fearDelta));
    rel.respect = clamp100(rel.respect + bd(u.respectDelta));
    rel.resentment = clamp100(rel.resentment + bd(u.resentmentDelta));
    rel.attraction = clamp100(rel.attraction + bd(u.attractionDelta));
    // Mirror into the opinion notes for the inspector.
    const op = syncOpinionFromRelationship(m, u.agentId, rel);
    if (u.note) {
      op.notes.push(u.note.slice(0, 140));
      if (op.notes.length > 5) op.notes = op.notes.slice(-5);
    }
  }

  if (out.reflectionSummary) m.lastReflection = out.reflectionSummary.slice(0, 280);
}

// ---------------------------------------------------------------------------
// Running reflections (async)
// ---------------------------------------------------------------------------

export type ReflectionRunResult = {
  reflected: number;
  fellBack: number;
  usedCloud: number;
};

export type PreparedReflection = {
  agentId: string;
  input: NightlyReflectionInput;
  wasMajor: boolean;
};

/**
 * Snapshot the inputs for the selected agents SYNCHRONOUSLY. This must run before
 * the caller clears the day's events, so the (possibly slow, async) provider
 * calls operate on a frozen view of "today" rather than racing the next day.
 */
export function prepareReflections(world: WorldState, agentIds: string[]): PreparedReflection[] {
  const out: PreparedReflection[] = [];
  for (const id of agentIds) {
    const a = world.agents[id];
    if (!a || !a.alive) continue;
    out.push({ agentId: id, input: buildReflectionInput(world, a), wasMajor: a.pendingMajorEvent });
  }
  return out;
}

/**
 * Run prepared reflections sequentially. Local models are typically
 * single-threaded, so sequential avoids overwhelming them and keeps the sim
 * responsive. On any provider error we apply the deterministic fallback so an
 * agent's mind always gets updated.
 */
export async function runPreparedReflections(
  world: WorldState,
  prepared: PreparedReflection[],
  localProvider: LLMProvider,
  cloudProvider: LLMProvider | null,
  config: LLMConfig,
  onWarn?: (msg: string) => void
): Promise<ReflectionRunResult> {
  let reflected = 0;
  let fellBack = 0;
  let usedCloud = 0;

  for (const p of prepared) {
    const agent = world.agents[p.agentId];
    if (!agent || !agent.alive) continue;

    const useCloud = config.useCloudForMajorEvents && cloudProvider != null && p.wasMajor;
    const provider = useCloud ? cloudProvider! : localProvider;

    let output: NightlyReflectionOutput;
    try {
      output = await provider.generateReflection(p.input);
      if (useCloud) usedCloud++;
    } catch (e) {
      output = deterministicReflection(p.input);
      fellBack++;
      onWarn?.(`${agent.name}: reflection fell back to deterministic (${(e as Error).message}).`);
    }

    applyReflection(world, agent, output);
    agent.lastReflectionDay = world.day;
    agent.pendingMajorEvent = false;
    reflected++;
  }

  if (reflected > 0) {
    logEvent(
      world,
      "reflection",
      `Nightly reflection: ${reflected} villager(s) reconsidered their lives` +
        (fellBack > 0 ? ` (${fellBack} via fallback)` : ``) +
        (usedCloud > 0 ? `, ${usedCloud} via cloud` : ``) +
        `.`,
      [],
      0
    );
  }
  return { reflected, fellBack, usedCloud };
}
