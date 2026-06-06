# AgentTown 🏘️

A top-down 2D simulation village where every character is an **autonomous agent** with a
unique personality, traits, needs, memories, relationships, resources and goals. The point
isn't to tell a story — it's to create the *conditions* (scarcity, personality, memory,
trust, fear, betrayal) from which stories emerge on their own.

Run a small village, watch it survive or collapse, click any villager to read their mind.

## Three levels of intelligence

The simulation is deliberately split so it stays fast and cheap while still feeling alive:

1. **Rule engine (every tick, deterministic code)** — movement, pathfinding, hunger, thirst,
   energy, hygiene, gathering, combat, theft, sharing, trading, building, reproduction,
   relationship math, birth and death. The engine is *reality*. See
   [`src/agents/decisionEngine.ts`](src/agents/decisionEngine.ts) and [`src/simulation/`](src/simulation/).

2. **Local small LLM (nightly / on meaningful events)** — the agent's *psychology*. It updates
   daily priorities, emotions, beliefs, goals, social opinions, strategy and private thoughts.
   It never moves an agent or edits the map — it only changes how they *feel* and what they'll
   *prioritise* tomorrow, which the rule engine then acts on. See [`src/llm/`](src/llm/).

3. **Optional cloud LLM (rare, major events)** — same job as level 2 but reserved for big moments
   (death, near-death, birth, betrayal) when `useCloudForMajorEvents` is on.

The app runs fully with **no LLM at all** (deterministic reflection), with a **mock** provider,
with a **local** model (Ollama / LM Studio), or **hybrid** local+cloud.

> **Core rule:** the LLM only influences `priorities, beliefs, emotions, goals, social opinions,
> strategy, private thoughts`. It never creates resources, kills/moves agents, or edits the map.
> All physical actions are validated and executed by the engine.

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). Press **Run**. Click a villager.

By default the LLM is set to **Ollama / qwen3:4b**, mode `major events + every 3 days`. If Ollama
isn't installed or reachable, agents transparently fall back to deterministic reflection and the
sim keeps running — you'll see a note in the LLM panel's fallback log. To try it purely
rule-based, set the provider to **Mock** (or disable the LLM) in the **LLM** tab.

### Using a local LLM (Ollama)

```bash
# install from https://ollama.com, then:
ollama pull qwen3:4b
# IMPORTANT: allow the browser to call Ollama (CORS):
#   macOS/Linux:  OLLAMA_ORIGINS=* ollama serve
#   Windows (PowerShell):  $env:OLLAMA_ORIGINS="*"; ollama serve
```

Then in the **LLM** tab pick **Ollama**, base URL `http://localhost:11434`, model `qwen3:4b`,
and click **Test connection**. Other good local models: `qwen3:1.7b`, `qwen3:8b`, `gemma3:4b`,
`phi4-mini`.

### Using LM Studio / any OpenAI-compatible server

Provider **LM Studio**, base URL `http://localhost:1234/v1`, model = whatever you've loaded.
Enable CORS in LM Studio's local server settings.

### Using the cloud (Anthropic) for major events only

Toggle **Cloud for major events**, set the cloud model (e.g. `claude-sonnet-4-6`) and paste an
API key. The key is stored only in your browser's localStorage. (Calling Anthropic directly from
the browser is fine for a local toy; for anything real, proxy it through a backend.)

## What to try

- **World presets** (top bar): Abundant Paradise, Balanced Village, Harsh Survival, Drought,
  Winter, Post-Collapse, Tiny Island, Overcrowded World. Same agents + rules, very different
  societies.
- **Config tab**: tune decay rates, scarcity, mutation/inheritance, and toggle whole systems
  (violence, stealing, trading, reproduction…). Export/Import a config as JSON.
- **Metrics tab**: population, trust, violence rate, inequality, cooperation, **collapse risk**
  and a rough **utopia score**.
- Click a villager to inspect needs, emotions, traits, skills, inventory, relationships,
  memories, beliefs, goals, current strategy and last LLM reflection.

## The eight founders

Mara the Caregiver · Brak the Survivor · Theo the Builder · Lina the Diplomat ·
Orin the Hoarder · Juno the Explorer · Sera the Farmer · Vale the Mystic.

Their starting traits are lopsided on purpose so each has a recognisable signature — but memory,
relationships and nightly reflection pull them in directions nobody scripted.

## Project layout

```
src/
  agents/        Agent factory, traits/skills/needs/memory/relationships/mind, decisionEngine
  simulation/    world, resources, pathfinding, tick, reproduction, conflict, communication,
                 groups, lifecycle, events, dayNightCycle, metrics
  llm/           provider abstraction (mock/ollama/lmstudio/openai/anthropic), promptBuilder,
                 schemas (Zod), repairJson, reflection orchestration
  ui/            WorldView (canvas), AgentPanel, SimulationControls, EventLog, ConfigPanel,
                 LLMSettingsPanel, MetricsPanel
  config/        defaultConfig, defaultAgents, presets
  state/         Zustand store (the game loop + config + LLM wiring)
  util/          deterministic RNG, math helpers
  types.ts       single source of truth for all data shapes
```

## Robustness notes

- Small local models return messy JSON. Output is **extracted, repaired, validated with Zod,
  clamped, and retried once**; if it's still unusable, a **deterministic reflection** is applied.
  See [`src/llm/repairJson.ts`](src/llm/repairJson.ts), [`src/llm/schemas.ts`](src/llm/schemas.ts).
- Reflections run **asynchronously** off a synchronous dawn snapshot, so a slow model never blocks
  the simulation and never reads the wrong day's events.
- The world uses a seeded PRNG, so a given seed + config reproduces the same run.

## Designed to extend

Factions, families, inheritance, laws/governance, gossip, reputation, disease, weather, seasons,
disasters, markets, war, and an experiment runner are intentionally left as next steps — the data
model (`Group`, `Message`, `Belief`, memory types, event types) and the rule-engine seams are
already in place for them.

## MVP scope (built)

2D grid world; 8 agents; food/water/wood/stone (+ medicine/tools/luxury); needs (hunger, thirst,
energy, hygiene, shelter, safety, social, reproduction); movement, gathering, talking, sharing,
stealing, attacking, fleeing, building shelters, reproduction; memory & relationships; event log;
config panel; rule-based daytime decisions; agent inspector; local/mock LLM nightly reflection;
Ollama + LM Studio/OpenAI-compatible + Anthropic providers; Zod validation; deterministic fallback.
