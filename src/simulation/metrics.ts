import { totalInventory } from "../agents/Agent";
import type { Metrics, WorldState } from "../types";
import { avg, clamp, gini } from "../util/math";
import { resourceDensity, livingAgents } from "./world";

/** Derive the live dashboard metrics from world state. Pure (no mutation). */
export function computeMetrics(world: WorldState): Metrics {
  const living = livingAgents(world);
  const pop = living.length;

  const avgHunger = avg(living.map((a) => a.needs.hunger));
  const avgThirst = avg(living.map((a) => a.needs.thirst));

  // Average trust across every relationship the living hold.
  const trusts: number[] = [];
  for (const a of living) {
    for (const id in a.relationships) {
      if (world.agents[id]?.alive) trusts.push(a.relationships[id].trust);
    }
  }
  const avgTrust = trusts.length ? avg(trusts) : 0;

  const dailyAttacks = avg(world.attackEventsRolling.length ? world.attackEventsRolling : [world.conflictsToday]);
  const violenceRate = pop > 0 ? dailyAttacks / pop : 0;

  const inequality = gini(living.map((a) => totalInventory(a.inventory)));

  let shelters = 0;
  for (const id in world.shelters) if (world.shelters[id].progress >= 100) shelters++;

  let factions = 0;
  for (const id in world.groups) if (world.groups[id].members.length >= 2) factions++;

  // Cooperation: warm relationships + sharing/healing signal, dampened by violence.
  const cooperationScore = clamp(
    50 + avgTrust * 0.4 - violenceRate * 60 + shelters * 3,
    0,
    100
  );

  const foodDensity = resourceDensity(world, "food");
  const foodStress = clamp(avgHunger * 0.6 + (foodDensity < 8 ? 30 : 0), 0, 100);
  const waterStress = clamp(avgThirst * 0.7 + (resourceDensity(world, "water") > 0 ? 0 : 30), 0, 100);

  const collapseRisk = clamp(
    foodStress * 0.3 +
      waterStress * 0.3 +
      violenceRate * 80 +
      (pop <= 2 ? 30 : 0) +
      inequality * 20 -
      shelters * 2,
    0,
    100
  );

  // Utopia: many alive, fed, watered, trusting, equal, sheltered, peaceful.
  const shelterCoverage = pop > 0 ? clamp((shelters / pop) * 100, 0, 100) : 0;
  const utopiaScore = clamp(
    (pop > 0 ? 20 : 0) +
      (100 - avgHunger) * 0.18 +
      (100 - avgThirst) * 0.18 +
      clamp(avgTrust, 0, 100) * 0.18 +
      (1 - inequality) * 18 +
      shelterCoverage * 0.12 -
      violenceRate * 50,
    0,
    100
  );

  return {
    population: pop,
    births: world.totalBirths,
    deaths: world.totalDeaths,
    avgHunger,
    avgThirst,
    avgTrust,
    violenceRate,
    resourceInequality: inequality,
    shelters,
    factions,
    cooperationScore,
    collapseRisk,
    utopiaScore,
  };
}
