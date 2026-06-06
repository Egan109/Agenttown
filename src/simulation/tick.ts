import { runAgentTick } from "../agents/decisionEngine";
import { applyNeedHealthEffects, decayNeeds } from "../agents/needs";
import type { Agent, WorldState } from "../types";
import { clamp100 } from "../util/math";
import type { Rng } from "../util/rng";
import { advanceClock } from "./dayNightCycle";
import { killAgent } from "./lifecycle";
import { regenerateResources } from "./resources";
import { livingAgents } from "./world";
import {
  prepareReflections,
  selectAgentsForReflection,
  type PreparedReflection,
} from "../llm/reflection";

export type TickResult = {
  newDay: boolean;
  /** Reflection inputs snapshotted at dawn for the store to run asynchronously. */
  prepared: PreparedReflection[];
};

/**
 * Advance the world by one tick. The store calls this repeatedly. At each dawn
 * we synchronously snapshot reflections (from the day that just ended) BEFORE
 * clearing that day's events, then return them for the store to run async.
 */
export function stepTick(world: WorldState, rng: Rng): TickResult {
  const newDay = advanceClock(world);
  let prepared: PreparedReflection[] = [];
  if (newDay) prepared = handleDawn(world);

  const actors = livingAgents(world); // snapshot — children born this tick won't act

  for (const agent of actors) {
    if (!agent.alive) continue;
    ageAndDecay(agent, world);
    runAgentTick(world, agent, rng);
  }

  // Resolve need/health damage and deaths after everyone has acted.
  for (const agent of actors) {
    if (!agent.alive) continue;
    applyNeedHealthEffects(agent);
    applyFrailty(agent, world);
    if (agent.health <= 0) {
      killAgent(world, agent, deathCause(agent));
    }
  }

  world.rngState = rng.state;
  return { newDay, prepared };
}

function ageAndDecay(agent: Agent, world: WorldState): void {
  agent.age += 1 / world.config.ticksPerDay;
  decayNeeds(agent, world.config);
}

/** The old grow frail; very high age makes death from any stress likely. */
function applyFrailty(agent: Agent, world: WorldState): void {
  if (agent.age > 70) {
    const frailty = (agent.age - 70) * 0.02;
    agent.health = clamp100(agent.health - frailty / world.config.ticksPerDay);
  }
}

function deathCause(agent: Agent): string {
  const n = agent.needs;
  if (agent.age > 80) return "old age";
  if (n.thirst > 90) return "dehydration";
  if (n.hunger > 90) return "starvation";
  if (n.shelter > 95) return "exposure";
  if (n.hygiene > 95) return "sickness";
  return "their injuries";
}

function handleDawn(world: WorldState): PreparedReflection[] {
  // Rolling violence count for the day that just ended (for metrics).
  world.attackEventsRolling.push(world.conflictsToday);
  if (world.attackEventsRolling.length > 10) world.attackEventsRolling.shift();

  // Snapshot reflections from yesterday's events BEFORE we clear them.
  const ids = selectAgentsForReflection(world);
  const prepared = prepareReflections(world, ids);

  // Renew the world and reset the day's books.
  regenerateResources(world);
  world.birthsToday = 0;
  world.deathsToday = 0;
  world.conflictsToday = 0;
  world.dailyAgentEvents = {};

  return prepared;
}
