// End-to-end LLM check against a LIVE Ollama server, using the EXACT app code
// path: run the engine a few days to build real events/relationships, then drive
// one agent through makeOllamaProvider().generateReflection() (prompt -> model ->
// JSON repair -> Zod normalize). Run via: esbuild bundle -> node (server must be up).
import { defaultAgentSpecs } from "../src/config/defaultAgents";
import { defaultConfig } from "../src/config/defaultConfig";
import { buildReflectionInput } from "../src/llm/reflection";
import { makeOllamaProvider } from "../src/llm/ollamaProvider";
import { stepTick } from "../src/simulation/tick";
import { createWorld, livingAgents } from "../src/simulation/world";
import { Rng } from "../src/util/rng";

async function main() {
  const config = JSON.parse(JSON.stringify(defaultConfig)) as typeof defaultConfig;
  config.llm.provider = "ollama";
  config.llm.model = "qwen3:4b";
  config.llm.think = false;

  const world = createWorld(config, defaultAgentSpecs, 12345);
  const rng = new Rng(12345);

  // Run ~6 days so agents accumulate events, memories and relationships.
  for (let i = 0; i < config.ticksPerDay * 6; i++) stepTick(world, rng);

  // Pick a living agent that actually had something happen today.
  const candidates = livingAgents(world).filter((a) => (world.dailyAgentEvents[a.id]?.length ?? 0) > 0);
  const agent = candidates[0] ?? livingAgents(world)[0];
  console.log(`Reflecting: ${agent.name} (${agent.persona.split(".")[0]})`);
  console.log(`  needs: hunger=${Math.round(agent.needs.hunger)} thirst=${Math.round(agent.needs.thirst)} safety=${Math.round(agent.needs.safety)} social=${Math.round(agent.needs.social)}`);
  console.log(`  today's events: ${(world.dailyAgentEvents[agent.id] ?? []).map((e) => e.text).join(" | ") || "(quiet)"}`);

  const input = buildReflectionInput(world, agent);
  const provider = makeOllamaProvider(config.llm);

  const t0 = Date.now();
  const out = await provider.generateReflection(input);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n--- reflection (${dt}s) ---`);
  console.log("strategy:", out.currentStrategy);
  console.log("summary :", out.reflectionSummary);
  console.log("thoughts:", out.privateThoughts.join(" / ") || "(none)");
  const pr = out.dailyPriorities;
  console.log(`priorities: food=${pr.food} water=${pr.water} safety=${pr.safety} social=${pr.social} cooperation=${pr.cooperation} revenge=${pr.revenge}`);
  const e = out.emotionalState;
  console.log(`emotions: happiness=${e.happiness} fear=${e.fear} anger=${e.anger} grief=${e.grief} hope=${e.hope}`);
  console.log("beliefs :", out.newBeliefs.map((b) => `"${b.statement}"`).join(", ") || "(none)");
  console.log("rel-updates:", out.relationshipUpdates.length);

  // Sanity: did the model actually produce varied, non-template values?
  const allPriZero = Object.values(pr).every((v) => v === 0);
  if (allPriZero || !out.currentStrategy) {
    console.error("\nLLM CHECK FAIL: output looks empty/templated.");
    process.exit(1);
  }
  console.log("\nLLM CHECK OK ✅ (real model output, validated)");
}

main().catch((err) => {
  console.error("LLM CHECK ERROR:", err.message);
  process.exit(1);
});
