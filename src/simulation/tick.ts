import { runAgentTick } from "../agents/decisionEngine";
import { applyNeedHealthEffects, decayNeeds } from "../agents/needs";
import type { Agent, WorldState } from "../types";
import { clamp100 } from "../util/math";
import type { Rng } from "../util/rng";
import { advanceClock } from "./dayNightCycle";
import { logEvent } from "./events";
import { killAgent } from "./lifecycle";
import { regenerateResources } from "./resources";
import { SEASON_HERALD, seasonForDay } from "./seasons";
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
    applyNeedHealthEffects(agent, world.config.ticksPerDay);
    applyFrailty(agent, world);
    if (agent.health <= 0) {
      let cause = deathCause(agent);
      let killer: Agent | undefined;
      // If this was really death from combat wounds (not starvation/age/etc.) and
      // a recent attacker is still alive, blame them so the village can feud.
      if (cause === "their injuries" && agent.lastAttackerId) {
        const k = world.agents[agent.lastAttackerId];
        if (k && k.alive && world.tick - (agent.lastAttackTick ?? 0) <= world.config.ticksPerDay) {
          killer = k;
          cause = `killed by ${k.name}`;
        }
      }
      killAgent(world, agent, cause, killer);
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

  // Herald a new season as it begins (world.day is already the new day here).
  if (world.config.seasonsEnabled && world.day > 0) {
    const season = seasonForDay(world.day);
    if (season !== seasonForDay(world.day - 1)) {
      logEvent(world, "system", SEASON_HERALD[season], [], 2);
    }
  }

  // Renew the world and reset the day's books.
  regenerateResources(world);
  spoilFood(world);
  world.birthsToday = 0;
  world.deathsToday = 0;
  world.conflictsToday = 0;
  world.dailyAgentEvents = {};
  // Free last night's sleeping slots so shelter capacity is enforced per-night.
  for (const id in world.shelters) world.shelters[id].occupantIds = [];

  return prepared;
}

// Food rots once per day. Carried (pack) food spoils much faster than food kept
// in a granary — the incentive to build and use communal stores.
const PACK_FOOD_SPOIL = 0.18; // 18%/day of food in an agent's pack
const GRANARY_FOOD_SPOIL = 0.03; // 3%/day of food in a granary

function spoilFood(world: WorldState): void {
  for (const id of world.agentOrder) {
    const a = world.agents[id];
    if (!a.alive) continue;
    const food = a.inventory.food ?? 0;
    if (food > 0) {
      const spoil = Math.round(food * PACK_FOOD_SPOIL);
      if (spoil > 0) a.inventory.food = food - spoil;
    }
  }
  for (const gid in world.foodStores) {
    const g = world.foodStores[gid];
    if (g.food > 0) g.food = Math.max(0, g.food - Math.round(g.food * GRANARY_FOOD_SPOIL));
  }
}
