// Audit reflection CADENCE (no LLM needed). Runs the real engine + the real
// selectAgentsForReflection scheduler for N days, faithfully simulating how the
// store applies reflections (set lastReflectionDay, clear pendingMajorEvent),
// then reports per-agent: # reflections, max gap between them, and flags anyone
// who exceeds the expected cadence. Run: esbuild bundle -> node.
import { defaultAgentSpecs } from "../src/config/defaultAgents";
import { defaultConfig } from "../src/config/defaultConfig";
import { stepTick } from "../src/simulation/tick";
import { createWorld } from "../src/simulation/world";
import { Rng } from "../src/util/rng";

const config = JSON.parse(JSON.stringify(defaultConfig)) as typeof defaultConfig;
const DAYS = 30;
const everyN = config.llm.reflectEveryNDays;
const cap = config.llm.maxAgentsPerBatch;

const world = createWorld(config, defaultAgentSpecs, 12345);
const rng = new Rng(12345);

// agentId -> { name, days: number[] (days they reflected), bornDay }
const rec: Record<string, { name: string; days: number[]; bornDay: number }> = {};
for (const id of world.agentOrder) rec[id] = { name: world.agents[id].name, days: [], bornDay: 1 };

let dawns = 0;
let totalReflections = 0;
let deferredDays = 0; // dawns where the per-night cap dropped someone eligible

for (let i = 0; i < DAYS * config.ticksPerDay; i++) {
  const res = stepTick(world, rng);
  // Register any newborns we haven't seen.
  for (const id of world.agentOrder) {
    if (!rec[id]) rec[id] = { name: world.agents[id].name, days: [], bornDay: world.day };
  }
  if (res.newDay && res.prepared.length) {
    dawns++;
    // Was anyone eligible but dropped by the cap this dawn?
    const eligible = world.agentOrder
      .map((id) => world.agents[id])
      .filter((a) => a.alive && (a.pendingMajorEvent || world.day - a.lastReflectionDay >= everyN)).length;
    if (eligible > res.prepared.length) deferredDays++;

    for (const p of res.prepared) {
      const a = world.agents[p.agentId];
      if (!a || !a.alive) continue;
      rec[p.agentId].days.push(world.day);
      a.lastReflectionDay = world.day; // mirror applyReflection's bookkeeping
      a.pendingMajorEvent = false;
      totalReflections++;
    }
  }
}

function maxGap(days: number[], bornDay: number, endDay: number): number {
  if (days.length === 0) return endDay - bornDay;
  let prev = bornDay;
  let g = 0;
  for (const d of days) {
    g = Math.max(g, d - prev);
    prev = d;
  }
  g = Math.max(g, endDay - prev); // trailing gap to "now"
  return g;
}

console.log(`=== reflection cadence over ${DAYS} days (every ${everyN} days + major events, cap ${cap}/night) ===`);
console.log(`dawns with reflections: ${dawns}, total reflections: ${totalReflections}, dawns where cap deferred someone: ${deferredDays}\n`);

const alive = world.agentOrder.filter((id) => world.agents[id].alive);
const problems: string[] = [];
// Allowed slack: the scheduler can run a day late when the population exceeds the
// nightly cap, so tolerate everyN + ceil(pop/cap) days between reflections.
const pop = alive.length;
const allowedGap = everyN + Math.max(0, Math.ceil(pop / cap) - 1) + 1;

console.log("agent       refl  maxGap  days");
for (const id of world.agentOrder) {
  const r = rec[id];
  const aliveNow = world.agents[id].alive;
  const endDay = aliveNow ? world.day : (world.agents[id].deathDay ?? world.day);
  const g = maxGap(r.days, r.bornDay, endDay);
  const tag = aliveNow ? "" : " (dead)";
  console.log(
    `${(r.name + tag).padEnd(12)} ${String(r.days.length).padStart(4)}  ${String(g).padStart(6)}  [${r.days.join(",")}]`
  );
  if (aliveNow && g > allowedGap) problems.push(`${r.name} went ${g} days without reflecting (allowed ~${allowedGap}).`);
  if (aliveNow && r.days.length === 0) problems.push(`${r.name} NEVER reflected.`);
}

console.log(`\npopulation now: ${pop}, allowed max gap ~${allowedGap} days`);
if (problems.length) {
  console.error("\nCADENCE ISSUES:\n" + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log("\nCADENCE OK ✅ everyone reflects within the expected window");
