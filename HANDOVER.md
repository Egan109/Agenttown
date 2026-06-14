# AgentTown — Handover

**Audience:** a Claude model picking this project up cold.
**Status:** MVP complete + **live local-LLM reflection verified** (Ollama / qwen3:4b). Type-checks
clean, builds, passes headless smoke + cadence audits + Playwright UI checks, dev server boots, and
the user has confirmed the UI works in the browser.
**Last verified:** 2026-06-14 on Node v24.16.0 / npm 11.13.0, RTX 3070, Windows 11.

AgentTown is a top-down 2D village where every agent is autonomous (traits, needs, memories,
relationships, goals). The goal is **emergent** social behavior — competition, cooperation,
reproduction, theft, feuds, factions, collapse or near-utopia — arising from conditions, not a
scripted story. Read [README.md](README.md) for the player-facing overview; this doc is the
engineering map.

**Added since the original MVP (newest work — details in §6):**
- **Daily chronicle / "Summary" tab:** after each reflection batch the narrator weaves the agents'
  reflections + the day's events into a short story (`llm/daySummary.ts`, JSON-constrained so qwen3
  reasoning doesn't leak). Shown in the EventLog "Summary" filter.
- **Food storage & spoilage:** communal **granaries** (`FoodStore`) — distinct from sleeping shelters;
  pack food spoils fast, stored food slowly; `store_food`/`get_food` actions; granary count soft-capped.
- **Sleep & shelter model:** agents sleep in long night stretches (hysteresis), one villager per
  shelter tile (`SHELTER_CAPACITY = 1`), per-night occupancy, proactive hut-building on shortage.
- **Day length is balance-neutral** (per-tick health/rest/spoilage scaled to a 60-tick reference);
  default `ticksPerDay = 600` so LLM dawn pauses interrupt rarely.
- **Event log never wipes the narrative** (reflections/chronicles/notable events kept forever; only
  chatter is bounded). Map: resource **icons** (🍎🌲🪨…), per-agent **action glyphs**, granary/shelter
  drawing, **hover tooltip** for granary stock / shelter occupants / resource amounts.
- **Playwright UI tests** (`npm run uicheck`) — real-browser layout/overflow checks + screenshots.

---

## 1. How to run & verify (do this first)

Node + npm are installed system-wide (`C:\Program Files\nodejs`, on PATH). From the project root:

```powershell
npm install        # already done once; re-run if node_modules is missing
npm run dev        # Vite dev server -> http://localhost:5173  (press ▶ Run, click a villager)
npm run typecheck  # tsc --noEmit  (MUST stay clean — strict, noUnusedLocals/Parameters on)
npm run build      # tsc --noEmit && vite build
npm run smoke      # headless: engine 20 sim-days, asserts invariants (no LLM), prints a report
npm run reflcheck  # headless: audits reflection CADENCE over 30 days (no LLM) — see §6a
npm run llmcheck   # headless: drives ONE real reflection through Ollama (server must be up) — see §6a
npm run uicheck    # Playwright: boots the app in real Chromium, asserts no clipping/overflow + screenshots
```

`npm run uicheck` ([tests/ui.spec.ts](tests/ui.spec.ts), [playwright.config.ts](playwright.config.ts)) is the
**visual** check jsdom can't do: it launches Chromium against the dev server (auto-started), asserts the page
and config panel don't overflow horizontally (the "cut off" bug class), confirms the core regions render and
the sim runs, and saves screenshots to `test-results/shots/*.png` so the rendered screen is inspectable. One-time
setup if `node_modules` is fresh: `npx playwright install chromium`.

**Always run `npm run typecheck` and `npm run smoke` after engine changes**, and `npm run reflcheck`
after touching reflection scheduling. The smoke test ([scripts/smoke.ts](scripts/smoke.ts)) runs the
deterministic engine for ~20 sim-days and fails if agents stop acting, needs/health go non-finite, no
events log, or everyone dies; it also reports shelters, granaries, stored food and a death-cause
breakdown — read those when balancing. All checks are deterministic given the seed. The `.mjs` bundles
land in `node_modules/.cache/` (gitignored).

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
    communication.ts          Messages: compose + send + relationship/memory effects; recordMessage()
    social.ts                 *** DETERMINISTIC SOCIAL SYSTEM *** intents/topics/templates +
                              scored choice with anti-repetition cooldowns + gossip + reactive threads.
                              doTalk delegates here (chooseInteraction -> performInteraction)
    conflict.ts               resolveAttack: combat power, damage, counterattack, loot, death
    lifecycle.ts              killAgent (the ONE death path) + grief ripple; noteBetrayal
    reproduction.ts           eligibility, pair checks, reproduce() with trait/skill inheritance
    groups.ts                 create/join/leave group, shared-group lookup
    dayNightCycle.ts          clock advance, isNight, lightLevel
    seasons.ts                Seasonal boom/famine: season derived from world.day, regen multiplier
                              (spring 1.3 -> winter 0.25); gated by config.seasonsEnabled
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
    daySummary.ts             Village "chronicle": weave the night's reflections + day's events
                              into a daily narrative (LLM via provider.generateJson, det. fallback)

  config/
    defaultConfig.ts          SimulationConfig + LLMConfig + ReproductionRules defaults
    defaultAgents.ts          The 8 founders (Mara/Brak/Theo/Lina/Orin/Juno/Sera/Vale)
    presets.ts                8 world presets (overrides on top of defaultConfig)

  state/store.ts              Zustand: game loop (setTimeout + `ticking` guard), config/LLM wiring,
                              SIM-PAUSING reflections (runLoopBody → runReflectionsBlocking)
  ui/                         WorldView (canvas+emotive faces+names), AgentPanel, SimulationControls
                              (reflect progress chip), EventLog (Events/Drama/Social/Minds filters),
                              ConfigPanel (incl. Day length slider), LLMSettingsPanel (incl. Thinking
                              toggle), MetricsPanel, ChronicleFeed (EventLog "Summary" tab), widgets
scripts/smoke.ts              Headless engine smoke test          (`npm run smoke`)
scripts/reflcheck.ts          Headless reflection-cadence audit   (`npm run reflcheck`)
scripts/llmcheck.ts           One real reflection via live Ollama (`npm run llmcheck`)
tests/ui.spec.ts              Playwright UI checks (overflow + screenshots)  (`npm run uicheck`)
playwright.config.ts          Playwright config (boots `npm run dev`, 1600×900 Chromium)
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
- **Reflection timing (subtle, don't break):** at dawn, `stepTick`→`handleDawn` **synchronously**
  snapshots reflection inputs (`prepareReflections`) from *yesterday's* events, THEN clears the
  day's events/counters and regenerates resources (so the snapshot is a frozen view of yesterday,
  regardless of how long the model takes).
- **Reflections PAUSE the sim (changed from the original async design).** The store's `runLoopBody`
  awaits `runReflectionsBlocking` before the next tick, so the world is frozen while villagers think.
  Three guards make this airtight (don't remove any): (1) a module-level `ticking` flag — only one
  tick body ever runs, so the sim can't advance during a reflection nor spawn a 2nd loop on a
  speed-change/re-mount; (2) `runReflectionsBlocking` early-returns if `llmStatus.reflecting` —
  never two batches at once; (3) `runPreparedReflections` skips any agent whose
  `lastReflectionDay === world.day` — an agent reflects at most once per day. Each reflection is
  streamed into the world log (purple, 🧠) as it lands, with a `llmStatus.progress` chip. (These
  three guards fixed a real duplicate-reflection bug; `npm run reflcheck` audits the cadence.)
- **Daily chronicle (EventLog "Summary" tab):** after each reflection batch finishes, the store
  calls `generateDaySummary` ([src/llm/daySummary.ts](src/llm/daySummary.ts)) to weave the agents'
  reflection summaries + the day's notable world events into one short third-person narrative,
  appended to `world.dailySummaries` and streamed to the log as a 📜 `chronicle` event. The
  "Summary" filter in [EventLog](src/ui/EventLog.tsx) renders these as narrator cards (`ChronicleFeed`
  in [DailyChroniclePanel.tsx](src/ui/DailyChroniclePanel.tsx)). It uses the provider's optional
  `generateJson` — **requested as JSON `{"chronicle","headlines"}` on purpose**: free-form prose let
  qwen3's chain-of-thought leak into the narration, and `format:"json"` suppresses it exactly as the
  reflection path does. The mock provider has no `generateJson`, so the no-LLM default uses the
  deterministic narrative. Like reflections, it is read-only over world state and runs inside the
  same sim-pause as the reflection batch.
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
- **Sleep is a night-time stretch, not scattered naps.** Rest scoring strongly prefers night and
  uses a hysteresis bonus (reads last tick's `currentAction`) so an agent who is already asleep
  stays asleep until dawn; daytime resting only happens when genuinely exhausted; hunger/thirst > 75
  or a nearby threat overrides sleep (`scoreActions` "Rest / sleep").
- **One villager per shelter tile (`SHELTER_CAPACITY = 1`) — no piling onto one tile.**
  `occupantIds` is now a *per-night* reservation (cleared each dawn in `tick.ts` `handleDawn`);
  `findUsableShelter` skips occupied or too-far (`SHELTER_SEEK_RANGE = 12`) huts. When slots are
  short village-wide (`housingShortage()` > 0) a ramped `shortBonus` (grows with the deficit, capped
  at 55 so the hungry still eat first) pushes agents to gather wood/stone and build **their own** hut
  — the seed reaches ~one shelter per resident (11 huts / 11 villagers), no exposure deaths. To raise
  or lower how many sleep per hut, change `SHELTER_CAPACITY`. `scripts/smoke.ts` now reports
  finished/in-progress shelters and a death-cause breakdown.

- **Day length:** `ticksPerDay` defaults to **600** (long so a real local-LLM dawn pause interrupts
  far less often). Tunable live via the Config tab "Day length" slider (12–1200). It is genuinely
  **balance-neutral**: need-decay (`needs.ts` `decayNeeds`) is per-day, and the per-tick *health*
  effects (`applyNeedHealthEffects`, scaled to a 60-tick reference) plus the per-tick *rest/shelter*
  deltas (`doRest`, scaled by `60/ticksPerDay`) and the per-day food spoilage do the same thing at any
  day length. (Before this scaling, lengthening the day silently multiplied exposure damage and wiped
  the village — if you add a survival-relevant per-tick effect, scale it the same way.)
- **Event-log retention.** The world log keeps the **full narrative forever** — reflections,
  chronicles and notable (severity ≥ 2) events are never trimmed (`isNarrative` in `events.ts`), so
  the "Minds"/"Summary"/"Drama" filters span day 1 → the last day. Only trivial chatter (greetings,
  ordinary trades) is bounded (`MAX_CHATTER = 3000`). The EventLog re-renders on event-count change
  (not every tick) and shows full history for filtered views; the noisy "All" view is capped at the
  last 1500 lines just to bound the DOM. Daily chronicles are likewise uncapped (`daySummary.ts`).
- **Food storage & spoilage (granaries).** Food now rots once per day (`tick.ts` `spoilFood`): food in
  an agent's **pack spoils fast (18%/day)**, food in a **granary slowly (3%/day)** — the incentive to
  store surplus. A `FoodStore` (granary) is a *communal* one-tile structure distinct from a sleeping
  shelter: wood-only (`GRANARY_WOOD_COST = 6`), `GRANARY_CAPACITY = 150`, drawn as a tan barn with a
  🌾 marker + fill bar. Two new actions (`store_food`/`get_food` in `decisionEngine.ts`): an agent
  with pack food above `FOOD_KEEP` (10) deposits the surplus (building a granary if none is reachable
  and it has wood), and a hungry agent with an empty pack draws from the nearest stocked granary.
  Granary count is soft-capped at ≈ one per 3 villagers (`underGranaryCap`) so the map isn't littered
  — the default seed settles to ~4 granaries. `scripts/smoke.ts` reports granary count + stored food.
- **Build-spot seeking:** an agent carrying materials but standing on forest/rock (where it gathered)
  now walks to the nearest open grass via `findBuildSpot` instead of re-choosing `build_shelter` and
  spinning in place — without this, a strong build drive burns thousands of no-op build ticks.

- **Food is the scarce, contested resource (2026-06 rebalance).** Originally food was so abundant the
  hunger slider was meaningless and the only conflict was Orin's hoarding. Food is now deliberately
  lean so the village competes for it (scarcity → hunger-theft → resentment → feuds → violence):
  - `world.ts` `generateTiles`: fewer food patches (`0.05*(0.2+scarcity)`) and slower per-tile regen.
  - `decisionEngine.ts` `autoConsume`: one food unit relieves **24** hunger (was 35) — agents must eat
    (and therefore gather/store) far more often.
  - `defaultConfig.ts` `hungerRate` default **20** (was 12); ConfigPanel slider max **120** (was 40)
    so it actually bites. At default the seed is tense-but-survivable (~10–12 alive, some combat, no
    starvation); at max it collapses into starvation + emergent murder.
- **Seasons (boom & famine) — `simulation/seasons.ts`, `config.seasonsEnabled` (default on).** Renewable
  regen swings through a 28-day year (4 × `SEASON_LENGTH_DAYS`=7): spring ×1.3, summer ×1.0, autumn
  ×0.6, **winter ×0.25**. Season is derived purely from `world.day` (no stored state → nothing extra to
  serialize, fully deterministic) and applied in `resources.ts` `regenerateResources`. Each season
  start logs a heralding `system` event (severity 2, kept forever); the current season shows as a chip
  in `SimulationControls` next to the day. This creates the intended store-surplus-for-winter survival
  loop — granaries (slow 3%/day spoilage) are how a village banks autumn food against winter. "Abundant
  Paradise" disables seasons (`presets.ts`) to stay frictionless. Smoke's default 20-day window ends as
  the first winter begins (D21); bump `DAYS` locally to watch a full year.

If you change scoring, re-run `npm run smoke` and watch: living count > 0 at day 20, some shelters
built, some social events. The smoke report prints the action mix and notable events.

### 6a. Headless checks (no browser needed)

- `npm run smoke` — engine integrity (agents act, needs/health finite, village survives ~20 days).
- `npm run reflcheck` — reflection **cadence**: every living agent reflects ≥ every `reflectEveryNDays`
  (+ extra on major events), no agent starved, no same-day duplicate. Verified clean (max gap = 3).
- `npm run llmcheck` — drives ONE real reflection through the live Ollama provider (prompt → model →
  repair → Zod) and asserts non-templated output. **Requires the Ollama server running.**

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
✅ LLM reflection (LIVE & verified): providers (mock/ollama/lmstudio/openai/anthropic), Zod
   validation + JSON repair + deterministic fallback, scheduling modes, hybrid local/cloud
✅ Reflections PAUSE the sim, stream into the log live (🧠, "Minds" filter), progress chip, with
   re-entrancy/dedup guards; qwen3 `think` flag (default off) + `keep_alive`
✅ UI: canvas world (emotive faces + floating names), agent inspector, controls (run/pause/step/
   reset/seed/speed/preset), event log w/ filters, config panel (+ Day length, export/import), LLM
   settings (+ test connection, thinking toggle), metrics panel
✅ 8 world presets; config persistence of LLM settings to localStorage
✅ Headless smoke + cadence (reflcheck) + live-LLM (llmcheck) checks; clean typecheck + build

**Added after the MVP (see §5/§6 for detail):**
✅ Daily **chronicle** narrator ("Summary" tab) — JSON-constrained so qwen3 reasoning doesn't leak
✅ `store_food`/`get_food` actions + communal **granaries** with per-day **food spoilage** (pack fast,
   store slow); granary count soft-capped; map drawing + hover tooltip
✅ Sleep model (long night stretches, hysteresis) + **one villager per shelter tile**, per-night
   occupancy, proactive hut-building on housing shortage
✅ Day length **balance-neutral** + default `ticksPerDay = 600`; slider 12–1200
✅ Event log keeps the **full narrative forever** (only chatter bounded); resource **icons** +
   per-agent **action glyphs** + granary/shelter drawing + tile **hover tooltip**
✅ **Playwright UI tests** (`npm run uicheck`) — real-browser overflow/layout checks + screenshots

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
4. **DONE — deterministic social system (`simulation/social.ts`, 2026-06).** `doTalk` no longer maps a
   stable relationship to one of four fixed lines (which flat-lined into the same utterance every tick).
   It now runs `chooseInteraction` → `performInteraction`: a scored loop over 15 **intents** (greet,
   share_idea/goal/struggle, ask_for_help, compliment, thank, reassure, invite, disagree, apologize,
   check_in, gossip_positive/negative, threat) × nearby targets, with **topic selection** (goals /
   struggles / world events / memories) and **anti-repetition cooldowns** (penalise the recently-used
   intent, target, template-family, and a near-veto on the exact sentence). **Gossip is event/opinion-
   based**: A tells B about a third party C, shifting B's opinion of C (positive → respect/trust up;
   negative → trust down / tension up), distorted by A's honesty and B's trust in A — so gossip now
   propagates distrust and can feed feuds. Short **threads** emerge via a reactive bonus (responding to a
   fresh inbound line: compliment→thank, share_struggle→reassure, idea→disagree, etc.). The requested
   trait set maps onto existing traits (kindness≈empathy+cooperation, gossip≈manipulativeness+low-honesty,
   insecurity≈anxiety); `Relationship.familiarity` was added as the one new social dimension. Tuning lives
   at the top of `social.ts` (cooldown windows) and in per-intent `score`/effect blocks. NOTE: negative
   gossip raises the listener's resentment toward the subject — a deliberate social→conflict link; dial
   the `gossip_negative` force in `performInteraction` if runs get too violent.

### C. Config toggles that currently do nothing (extension points already plumbed)
5. `diseaseEnabled`, `weatherEnabled`, `disastersEnabled` exist in `SimulationConfig` + UI but have
   no implementation. Add systems in `simulation/` and call them from `stepTick`/`handleDawn`.
   "Catastrophes" (fire/drought/flood/disease/animal attack/stranger arrives) belong here.
   (NOTE: **seasons** — `seasonsEnabled` — *are* implemented, see `simulation/seasons.ts` and §6;
   `weatherEnabled` is the seam for finer-grained weather on top of the seasonal baseline.)

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
| Daily chronicle / Summary tab | `llm/daySummary.ts`, `ui/DailyChroniclePanel.tsx` (`ChronicleFeed`), `ui/EventLog.tsx` |
| Food storage / granaries / spoilage | `agents/decisionEngine.ts` (`doStoreFood`/`doGetFood`, `underGranaryCap`), `simulation/tick.ts` (`spoilFood`), `ui/WorldView.tsx` (`drawGranary`) |
| LLM output schema/validation | `llm/schemas.ts`, `llm/reflection.ts` (`applyReflection`) |
| Reflection scheduling | `llm/reflection.ts` (`selectAgentsForReflection`), `simulation/tick.ts` |
| Game loop / config wiring | `state/store.ts` |
| World rendering / faces / names | `ui/WorldView.tsx` |
| Inspector fields | `ui/AgentPanel.tsx` |
| Default balance numbers | `config/defaultConfig.ts`, and weights in `decisionEngine.ts` |
| Presets | `config/presets.ts` |
