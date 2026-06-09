# AgentTown — Handover

**Audience:** a Claude model picking this project up cold.
**Status:** MVP complete, type-checks clean, builds, passes a headless runtime smoke test, and the
Vite dev server boots. Not yet exercised by a human click-through in the browser.
**Last verified:** 2026-06 on Node v24.16.0 / npm 11.13.0 (Windows 11).

AgentTown is a top-down 2D village where every agent is autonomous (traits, needs, memories,
relationships, goals). The goal is **emergent** social behavior — competition, cooperation,
reproduction, theft, feuds, factions, collapse or near-utopia — arising from conditions, not a
scripted story. Read [README.md](README.md) for the player-facing overview; this doc is the
engineering map.

---

## 1. How to run & verify (do this first)

Node + npm are installed system-wide (`C:\Program Files\nodejs`, on PATH). From the project root:

```powershell
npm install        # already done once; re-run if node_modules is missing
npm run dev        # Vite dev server -> http://localhost:5173  (press ▶ Run, click a villager)
npm run typecheck  # tsc --noEmit  (MUST stay clean — strict, noUnusedLocals/Parameters on)
npm run build      # tsc --noEmit && vite build
npm run smoke      # headless: drives the engine 20 sim-days, asserts invariants, prints a report
```

**Always run `npm run typecheck` and `npm run smoke` after engine changes.** The smoke test
([scripts/smoke.ts](scripts/smoke.ts)) is the fastest way to catch regressions: it runs the
deterministic engine (no LLM) for 480 ticks and fails if agents stop acting, needs/health go
non-finite, no events log, or everyone dies in 20 days. It's deterministic given the seed.

**Windows gotchas already resolved (don't re-debug):**
- `npm not recognized` → Node is on PATH now; open a *new* terminal after any PATH change.
- `npm.ps1 cannot be loaded` → execution policy `CurrentUser` is set to `RemoteSigned`.
- A leftover `C:\Users\egan1\nodejs-portable\` folder exists from an earlier stopgap; unused, deletable.

---

## 2. Tech stack & conventions

- **TypeScript + React 18 + Vite 5**, **Zustand** (state/loop), **Zod** (LLM output validation),
  Canvas 2D for the world.
- `tsconfig.json` is **strict** with `noUnusedLocals`/`noUnusedParameters`. Because of the
  `react-jsx` runtime, **do not `import React`** in a `.tsx` file unless you use `React.*` (it'll
  flag as unused). Import only the hooks you use.
- Determinism: all randomness goes through a seeded PRNG ([src/util/rng.ts](src/util/rng.ts)),
  not `Math.random`, so seed + config reproduces a run. The store holds one `Rng`; `world.rngState`
  is the serializable state.
- File/line references in this repo use markdown links so they're clickable in the IDE.

---

## 3. Architecture — three levels of intelligence

This split is the core design and **must be preserved**.

**Level 1 — Rule engine (every tick, deterministic).** The source of truth ("the engine is
reality"). Scores ~18 candidate actions from needs + LLM-shaped priorities + traits + skills +
relationships + surroundings, picks the best (with trait-scaled noise), executes it.
→ [src/agents/decisionEngine.ts](src/agents/decisionEngine.ts) + [src/simulation/](src/simulation/).

**Level 2 — Local LLM (nightly / on major events).** Updates only an agent's **mind**
(daily priorities, emotions, beliefs, goals, social opinions, strategy, private thoughts). Output
is extracted → repaired → Zod-validated → clamped → retried once → deterministic fallback.
→ [src/llm/](src/llm/).

**Level 3 — Cloud LLM (optional, rare).** Anthropic provider for major events only; off by default.

**The hard invariant (see the "Core Rule" in the original spec):** the LLM may influence
`priorities, beliefs, emotions, goals, social opinions, strategy, private thoughts` and *nothing
else*. It never moves agents, edits the map, or creates/kills/teleports resources or lives. Even
the `relationshipUpdates` it emits are bounded to ±40/night in
[src/llm/reflection.ts](src/llm/reflection.ts) (`applyReflection`) before they touch the numbers
the rule engine reads. **Do not let the LLM mutate world state directly.**

---

## 4. File map (what lives where)

```
src/
  types.ts                    Single source of truth for ALL data shapes. Start here.
  main.tsx / App.tsx          Entry + 3-column layout (left tabs / center world+log / right inspector)
  index.css                   Dark theme, CSS vars, .panel/.bar/.tag helpers

  util/
    rng.ts                    Seeded mulberry32 PRNG (Rng class) + string hash
    math.ts                   clamp/clamp100/clampSigned, manhattan/chebyshev, gini, avg, uid

  agents/
    Agent.ts                  createAgent(spec), inventory helpers, color-from-id
    traits.ts                 33 traits (0..100), groups, random/inherit (mutation)
    skills.ts                 10 skills, practiceSkill (diminishing returns), inheritSkills
    needs.ts                  8 needs, decayNeeds, applyNeedHealthEffects (starvation/exposure)
    memory.ts                 Memory add (capped, salience-weighted), recall helpers
    relationships.ts          Relationship math + INTERACTION_EFFECTS (share/steal/attack/heal/…)
    mind.ts                   Defaults for priorities/emotions/opinions; sync opinion<-relationship
    decisionEngine.ts         *** THE BRAIN *** perceive → scoreActions → chooseAction → execute

  simulation/
    world.ts                  WorldState, tile gen, spatial/resource queries, createWorld, nextId
    pathfinding.ts            BFS over walkable grid (adjacentOk for water)
    resources.ts              gather yields, extractFromTile, daily regeneration
    events.ts                 World event log + per-agent daily feed (drives reflection)
    communication.ts          Messages: compose + send + relationship/memory effects
    conflict.ts               resolveAttack: combat power, damage, counterattack, loot, death
    lifecycle.ts              killAgent (the ONE death path) + grief ripple; noteBetrayal
    reproduction.ts           eligibility, pair checks, reproduce() with trait/skill inheritance
    groups.ts                 create/join/leave group, shared-group lookup
    dayNightCycle.ts          clock advance, isNight, lightLevel
    tick.ts                   stepTick(): physics + dawn snapshot of reflections (returns prepared[])
    metrics.ts                computeMetrics(): pop, trust, violence, inequality, collapse, utopia

  llm/
    provider.ts               createProvider(config) factory + testConnection()
    mockProvider.ts           deterministicReflection() — pure, also the fallback
    ollamaProvider.ts         /api/chat + pingOllama
    lmStudioProvider.ts       OpenAI-compatible /v1/chat/completions (LM Studio & OpenAI) + ping
    anthropicProvider.ts      /v1/messages (cloud, optional)
    chatReflection.ts         runReflectionChat: prompt→call→parse→validate→repair-retry
    promptBuilder.ts          system + user prompt + strict JSON shape
    schemas.ts                Zod schemas, clamping, normalizeReflection()
    repairJson.ts             strip <think>/fences, extract first object, light repair, parse
    reflection.ts             buildReflectionInput, selectAgentsForReflection, prepare/run, apply

  config/
    defaultConfig.ts          SimulationConfig + LLMConfig + ReproductionRules defaults
    defaultAgents.ts          The 8 founders (Mara/Brak/Theo/Lina/Orin/Juno/Sera/Vale)
    presets.ts                8 world presets (overrides on top of defaultConfig)

  state/store.ts              Zustand: game loop (setTimeout), config/LLM wiring, async reflections
  ui/                         WorldView (canvas+faces+names), AgentPanel, SimulationControls,
                              EventLog, ConfigPanel, LLMSettingsPanel, MetricsPanel, widgets
scripts/smoke.ts              Headless engine test (run via `npm run smoke`)
```

Note: the original spec listed `agents/ruleBasedAgent.ts` — that role is fully covered by
`decisionEngine.ts` (`runAgentTick`), so no separate file was made.

---

## 5. Key data flow (read once, saves hours)

- **Tick loop:** `store.scheduleLoop` (setTimeout, speed = ticks/sec) → `stepTick(world, rng)` →
  for each living agent: `decayNeeds` → `runAgentTick` (autoConsume → perceive → chooseAction →
  execute) → then `applyNeedHealthEffects` + frailty → `killAgent` if dead. Store recomputes
  metrics and bumps `tick` (a counter that forces React re-renders; components read `world` via
  `useStore.getState()` to avoid deep reactivity).
- **Consumption model:** agents *gather* food/water into inventory; hunger/thirst are satisfied
  **automatically** from inventory in `autoConsume`. So `gather_food` fills the larder; eating is
  implicit. (There is intentionally no `eat`/`drink` action.)
- **Reflection timing (subtle, don't break):** at dawn, `stepTick` calls `handleDawn` which
  **synchronously** snapshots reflection inputs (`prepareReflections`) from *yesterday's* events,
  THEN clears the day's events/counters and regenerates resources. The store runs the snapshot
  through the provider **asynchronously** (`runPreparedReflections`) so a slow local model never
  blocks the sim and never reads the wrong day's events. Overlapping batches are dropped
  (`llmStatus.reflecting` guard).
- **Major-event flagging:** physical systems (conflict, theft, lifecycle, reproduction, groups)
  set `agent.pendingMajorEvent = true`. `selectAgentsForReflection` prioritizes those, plus a
  periodic catch-up every `reflectEveryNDays`. Default mode `major_events_only` = both.
- **Rendering:** `WorldView` runs its own `requestAnimationFrame` loop reading the store directly
  (not via React) for 60fps canvas. Agents draw body + emotive face (`dominantMood`) + floating
  name. Faces only show when cells are big enough.

---

## 6. Current balance state (tuned, but a moving target)

The engine was tuned so the **default seed/preset (12345, Balanced Village) produces a lively but
survivable run**: village grows ~8→11, couples form and reproduce, shelters get built, Orin (the
Hoarder) commits occasional theft, low deaths. Harsh presets (Drought/Post-Collapse/Harsh
Survival) push toward conflict/collapse.

Balance knobs that were deliberately set (all in `decisionEngine.ts` `scoreActions` unless noted):
- **Attacks require provocation:** `pickAttackTarget` only returns a target with resentment > 28
  (no cold murder of peaceful neighbors). Violence emerges from feuds (theft → resentment → attack).
- **Theft has 3 distinct motives:** hunger (must be poor+hungry), greed (>70 hoarders, persistent),
  revenge. Prevents constant theft spam while keeping the hoarder archetype.
- **Shelter is reachable & communal:** build-intent bonuses steer agents to gather the *missing*
  material; `doRest` makes exposed agents path to any usable finished shelter. Exposure damage is
  mild (`needs.ts`). Without this the village always died of exposure (no one built).
- `SHELTER_WOOD_COST = 12`, `SHELTER_STONE_COST = 4`.

If you change scoring, re-run `npm run smoke` and watch: living count > 0 at day 20, some shelters
built, some social events. The smoke report prints the action mix and notable events.

---

## 7. What's DONE (MVP scope)

✅ 2D grid world, terrain gen, 8 founders, resources (food/water/wood/stone + medicine/tools/luxury)
✅ Needs (hunger/thirst/energy/hygiene/shelter/safety/social/reproduction) with decay & health effects
✅ Actions: move/explore, gather ×4, build_shelter, rest, clean_self, talk, share, trade, steal,
   attack, flee, heal, reproduce, form_group, join_group, craft_tool
✅ Memory (salience-capped) + mechanical relationships + interaction effects
✅ Conflict (combat, counterattack, loot, death), reproduction (inherited traits/skills + mutation)
✅ Groups/factions (basic), day/night cycle, event log + per-agent feed
✅ Rule-based daytime decisions; metrics (collapse risk, utopia score, inequality, cooperation)
✅ LLM reflection: providers (mock/ollama/lmstudio/openai/anthropic), Zod validation + JSON repair +
   deterministic fallback, async non-blocking, scheduling modes, hybrid local/cloud
✅ UI: canvas world (emotive faces + floating names), agent inspector, controls (run/pause/step/
   reset/seed/speed/preset), event log w/ filters, config panel (+export/import), LLM settings
   (+test connection), metrics panel
✅ 8 world presets; config persistence of LLM settings to localStorage
✅ Headless smoke test + clean typecheck + production build

---

## 8. What's LEFT to do (prioritized)

### A. Verification gaps (do these next, cheap & important)
1. **Human browser click-through.** UI confirmed working by the user; still worth a pass on:
   day/night tint, speed buttons, preset switch rebuilds world, config sliders, export/import config.
2. **Real local-LLM run — DONE & VERIFIED (2026-06).** Ollama is installed (system-wide), the
   server runs with `OLLAMA_ORIGINS=*` (persisted as a user env var so the tray app keeps it),
   `qwen3:4b` is pulled, and the full pipeline (engine → `buildReflectionInput` → ollama `/api/chat`
   → JSON repair → Zod) was verified end-to-end via `scripts/llmcheck.ts` (bundle with esbuild and
   run with node while the server is up). It produced validated, in-character reflections.

   **qwen3 gotchas handled (don't regress these):**
   - qwen3 is a *hybrid thinking* model. With thinking on + `format:"json"` it spends the whole
     token budget reasoning and emits an **empty** `content`. So `ollamaProvider` sends
     `think: config.think ?? false` (default off). A "Thinking mode" toggle exists in the LLM panel;
     if turned on, `maxTokens` must be ≥ ~2500.
   - **Echo trap:** the old prompt showed all-`0` placeholder values and said "return exactly," so a
     4B model parroted the zeros. Fixed in `llm/promptBuilder.ts`: the example uses varied numbers,
     is explicitly labelled "EXAMPLE — replace every value," and the system prompt forbids copying.
     If you edit the prompt, keep those guardrails or small models will echo the template.
   - `keep_alive: "30m"` is sent so the model stays resident in VRAM (~2-3s/reflection warm; first
     cold call ~15-18s while it loads).
   - Hardware here: RTX 3070 (8 GB VRAM, Windows under-reports it as 4 GB), 48 GB RAM — GPU-accelerated.

### B. Declared-but-not-wired (quick wins — types exist, behavior doesn't)
3. **Actions in the `AgentAction` type that are never scored/executed:** `teach`, `leave_group`,
   `propose_law`. Add scoring in `scoreActions` + an executor + a switch case in `runAgentTick`.
   `teach` is easiest (boost a nearby agent's skill, practice teaching). `propose_law` is the seam
   into governance (item D).
4. **Unused `MessageType`s:** `gossip`, `request_resource`, `offer_trade`, `confession`,
   `warning`, `reproduction_proposal`, `law_proposal`. `doTalk` only uses greeting/threat/apology/
   proposal/alliance_offer. **Gossip** is the highest-value add (spec calls it out): agent A tells B
   about C, shaded by honesty/manipulativeness, mutating B's opinion of C. Hook into
   `communication.ts` + a `gossip` branch in `doTalk`.

### C. Config toggles that currently do nothing (extension points already plumbed)
5. `diseaseEnabled`, `weatherEnabled`, `disastersEnabled` exist in `SimulationConfig` + UI but have
   no implementation. Add systems in `simulation/` and call them from `stepTick`/`handleDawn`.
   "Catastrophes" (fire/drought/flood/disease/animal attack/stranger arrives) belong here.

### D. Larger features from the original spec (design seams exist)
6. **Laws & governance:** propose/support/oppose/break/enforce laws, punishment, exile. `Group` +
   leadership traits + `propose_law` action are the seeds. Leadership selection by
   charisma/leadership/respect/fear/dominance/wisdom.
7. **Families / inheritance / culture:** `familyIds`/`groupIds` exist; reproduction already seeds
   parent-child relationships and inherits group culture. Build kin preference, child-rearing,
   belief spreading.
8. **Reputation system** (village-wide opinion aggregation), **markets/trading** (current trade is a
   fixed 4-for-4 swap), **education** (teach action), **toolmaking/construction** beyond shelters.
9. **Seasons/weather/migration**, **war/peace treaties** between factions.
10. **Experiment runner / multi-run comparisons:** run N sims headless across configs and compare
    violence/population/cooperation/lifespan/collapse. `scripts/smoke.ts` is a starting point — it
    already drives the engine headlessly and reads metrics; generalize it into a batch runner that
    sweeps presets/seeds and emits a CSV.

### E. Polish / known rough edges
11. `metrics.ts` `violenceRate` is a rough rolling average; tune for the UI bar scale.
12. Canvas name labels can overlap in crowded clusters — consider culling/declutter at small cells.
13. No save/load of a *running world* (only config export/import). Add world serialization
    (everything's plain JSON-able; `rngState` is already a number) for snapshots/replays.
14. Reflection batches are sequential and capped at `maxAgentsPerBatch` per dawn; for big villages
    consider true batch prompts (`generateBatchReflection` is optional on the provider interface,
    currently unused).

---

## 9. Conventions to keep (so the next change doesn't fight the codebase)

- Add new agent behavior as: a scored candidate in `scoreActions`, an executor function, and a
  `switch` case in `runAgentTick`. Keep scoring expressed in terms of needs/priorities/traits so
  personality drives it (see the existing weights as the house style).
- Physical consequences (HP, inventory, death, births, map) happen **only** in the engine. The LLM
  layer reads a snapshot and returns mind deltas — clamp everything in `applyReflection`.
- Route all randomness through the passed-in `Rng`. Don't call `Math.random` in sim code (UI/reset
  seed selection is the only exception).
- Every death goes through `lifecycle.killAgent` (it handles grief, group/shelter cleanup, logging).
- Keep `npm run typecheck` clean (strict) and `npm run smoke` green before declaring done.
- The 8 founders' personalities live in `config/defaultAgents.ts`; trait/skill keys must match the
  `AgentTraits`/`AgentSkills` types exactly (a bad key is a type error).

---

## 10. Quick "where do I touch X?" index

| Want to change… | Go to |
|---|---|
| What an agent decides to do | `agents/decisionEngine.ts` (`scoreActions`, `runAgentTick`) |
| Combat outcome | `simulation/conflict.ts` |
| Birth/inheritance | `simulation/reproduction.ts` |
| Death handling | `simulation/lifecycle.ts` |
| Need decay / starvation | `agents/needs.ts` |
| Map / terrain / resource spawn | `simulation/world.ts`, `simulation/resources.ts` |
| Metrics / utopia·collapse score | `simulation/metrics.ts` |
| LLM prompt | `llm/promptBuilder.ts` |
| LLM output schema/validation | `llm/schemas.ts`, `llm/reflection.ts` (`applyReflection`) |
| Reflection scheduling | `llm/reflection.ts` (`selectAgentsForReflection`), `simulation/tick.ts` |
| Game loop / config wiring | `state/store.ts` |
| World rendering / faces / names | `ui/WorldView.tsx` |
| Inspector fields | `ui/AgentPanel.tsx` |
| Default balance numbers | `config/defaultConfig.ts`, and weights in `decisionEngine.ts` |
| Presets | `config/presets.ts` |
