// Headless smoke test: drive the deterministic engine for several days and make
// sure agents act, events fire, births/deaths are possible, and nothing throws.
// Run via: esbuild bundle -> node (see verify step). Not part of the app build.
import { defaultAgentSpecs } from "../src/config/defaultAgents";
import { defaultConfig } from "../src/config/defaultConfig";
import { computeMetrics } from "../src/simulation/metrics";
import { stepTick } from "../src/simulation/tick";
import { createWorld } from "../src/simulation/world";
import { Rng } from "../src/util/rng";

const config = { ...defaultConfig };
const world = createWorld(config, defaultAgentSpecs, 12345);
const rng = new Rng(12345);

const DAYS = 20;
const totalTicks = DAYS * config.ticksPerDay;

const actionCounts: Record<string, number> = {};
let reflectionsPrepared = 0;

for (let i = 0; i < totalTicks; i++) {
  const res = stepTick(world, rng);
  if (res.newDay) reflectionsPrepared += res.prepared.length;
  for (const id of world.agentOrder) {
    const a = world.agents[id];
    if (a?.alive && a.currentAction) {
      actionCounts[a.currentAction] = (actionCounts[a.currentAction] ?? 0) + 1;
    }
  }
}

const m = computeMetrics(world);
const living = world.agentOrder.filter((id) => world.agents[id].alive).length;

const finishedShelters = Object.values(world.shelters).filter((s) => s.progress >= 100).length;
const unfinishedShelters = Object.values(world.shelters).filter((s) => s.progress < 100).length;
const deathCauses: Record<string, number> = {};
for (const id of world.agentOrder) {
  const a = world.agents[id];
  if (!a.alive && a.causeOfDeath) deathCauses[a.causeOfDeath] = (deathCauses[a.causeOfDeath] ?? 0) + 1;
}

console.log("=== AgentTown smoke test ===");
console.log(`ran ${totalTicks} ticks over ${DAYS} days`);
console.log(`living: ${living}  totalBirths: ${world.totalBirths}  totalDeaths: ${world.totalDeaths}`);
console.log(`events logged: ${world.events.length}`);
console.log(`reflection inputs prepared at dawns: ${reflectionsPrepared}`);
console.log(`metrics: pop=${m.population} avgHunger=${m.avgHunger.toFixed(1)} avgThirst=${m.avgThirst.toFixed(1)} avgTrust=${m.avgTrust.toFixed(1)} utopia=${m.utopiaScore.toFixed(0)} collapse=${m.collapseRisk.toFixed(0)}`);
console.log("action mix:", actionCounts);
console.log(`shelters: ${finishedShelters} finished, ${unfinishedShelters} in progress`);
console.log("death causes:", Object.keys(deathCauses).length ? deathCauses : "(none)");

// Sample a few recent dramatic events.
const drama = world.events.filter((e) => e.severity >= 2).slice(-6).map((e) => `D${e.day}: ${e.text}`);
console.log("recent notable events:\n" + (drama.join("\n") || "  (none)"));

// Basic sanity assertions.
const problems: string[] = [];
if (world.events.length === 0) problems.push("no events were logged");
if (Object.keys(actionCounts).length < 3) problems.push("agents barely acted");
if (living === 0) problems.push("everyone died in 12 days (too lethal)");
for (const id of world.agentOrder) {
  const a = world.agents[id];
  if (!Number.isFinite(a.health) || a.health < 0 || a.health > 100) problems.push(`${a.name} bad health ${a.health}`);
  for (const k in a.needs) {
    const v = (a.needs as Record<string, number>)[k];
    if (!Number.isFinite(v)) problems.push(`${a.name} bad need ${k}=${v}`);
  }
}

if (problems.length) {
  console.error("SMOKE FAIL:\n" + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log("\nSMOKE OK ✅");
