# CLAUDE.md — AgentTown

Operating guide for working in this repo. For the full engineering map (file-by-file, data flow,
balance knobs, "where do I touch X?"), read **[HANDOVER.md](HANDOVER.md)** — keep it updated when you
make notable changes.

## What this is
A top-down 2D village sim where every villager is an autonomous agent (traits, needs, memories,
relationships, goals). The point is **emergent** social behavior — cooperation, theft, feuds,
reproduction, collapse or near-utopia — arising from conditions, not a script. TypeScript + React 18 +
Vite 5, Zustand (state/loop), Zod (LLM output validation), Canvas 2D for the world.

## Commands (Windows / PowerShell; Node on PATH at `C:\Program Files\nodejs`)
```powershell
npm run dev        # Vite dev server -> http://localhost:5173
npm run typecheck  # tsc --noEmit (strict; MUST stay clean)
npm run build      # tsc --noEmit && vite build
npm run smoke      # headless engine, ~20 sim-days; asserts invariants, prints action mix / shelters /
                   #   granaries / death causes (no LLM, deterministic)
npm run reflcheck  # headless reflection-cadence audit (no LLM)
npm run llmcheck   # ONE real reflection via live Ollama (server must be up)
npm run uicheck    # Playwright: real Chromium, asserts no clipping/overflow, saves test-results/shots/*.png
```
**After engine changes run `typecheck` + `smoke`**; after reflection-scheduling changes also `reflcheck`;
after UI changes `uicheck` (one-time `npx playwright install chromium` if node_modules is fresh).

## The three levels of intelligence (core design — preserve it)
1. **Rule engine** — every tick, deterministic, the source of truth ("the engine is reality").
   `agents/decisionEngine.ts` (`scoreActions` → `chooseAction` → `runAgentTick`) + `simulation/`.
2. **Local LLM** — nightly/on-major-event, updates only an agent's **mind**. `llm/`.
3. **Cloud LLM** — optional, rare. Off by default.

## Hard invariants (do not break)
- **The LLM only ever influences an agent's MIND** (priorities, beliefs, emotions, goals, social
  opinions, strategy, private thoughts). It never moves agents, edits the map, or creates/kills/moves
  resources or lives. All LLM output is clamped in `applyReflection` (`llm/reflection.ts`). The daily
  chronicle (`llm/daySummary.ts`) is read-only over world state too.
- **Determinism:** all randomness goes through the seeded `Rng` (`util/rng.ts`), never `Math.random`
  in sim code (UI reset-seed is the only exception). Seed + config reproduces a run.
- **Every death** goes through `simulation/lifecycle.killAgent` (handles grief, cleanup, logging).
  A **killing** also passes the `killer` to `killAgent`, which turns the village against them: those
  who loved the victim gain resentment (≥ the rule engine's revenge threshold of 28) + fear toward the
  killer, so feuds/retaliation emerge mechanically (not just in LLM prose). Combat deaths that finalize
  a tick later via need/frailty damage are still attributed to the recent attacker (`lastAttackerId`/
  `lastAttackTick` on `Agent`, resolved in `tick.ts`) so "their injuries" murders aren't anonymous.

## Conventions
- Add agent behavior as: a scored candidate in `scoreActions`, an executor fn, and a `switch` case in
  `runAgentTick`. Keep scoring in terms of needs/priorities/traits so personality drives it.
- **Dialogue/social lives in `simulation/social.ts`, not `doTalk`.** To add a conversational behavior:
  add a `SocialIntent`, a `TEMPLATES` entry, a `scoreIntent` branch (needs/traits/relationship/topic +
  eligibility), and a `performInteraction` effect. Variety is kept by the anti-repetition cooldowns —
  don't bypass them. It must stay deterministic (no `Math.random`; choices are argmax over scores).
- **Strict tsconfig** (`noUnusedLocals`/`noUnusedParameters`). With the `react-jsx` runtime, **do not
  `import React`** in `.tsx` unless you use `React.*` — import only the hooks you use.
- **Day length must stay balance-neutral.** Per-DAY effects divide by `ticksPerDay` (`needs.ts`
  `decayNeeds`); per-TICK health/rest/shelter effects scale by `60/ticksPerDay` (`needs.ts`
  `applyNeedHealthEffects`, `decisionEngine.ts` `doRest`). If you add a per-tick effect that matters
  for survival, scale it the same way or changing day length will silently break balance.
- File/line references use markdown links so they're clickable in the IDE.
- Tests live in `tests/` (Playwright, excluded from app `tsc` via `include: ["src"]`). Headless engine
  checks live in `scripts/`.

## Gotchas already solved (don't re-debug)
- **qwen3 reasoning leak:** request JSON (`format:"json"` / `response_format`) for any local-LLM call —
  it suppresses qwen3's chain-of-thought. Both reflections and the chronicle rely on this.
- **Prompt echo trap:** the reflection prompt example uses varied (non-zero) numbers, labelled
  "replace every value" — keep that or small models parrot the template (`llm/promptBuilder.ts`).
- **Reflections PAUSE the sim** via three re-entrancy/dedup guards in `state/store.ts` — don't remove
  any; `reflcheck` audits the cadence.
- **Shelter/granary tiles** can't stack: `isBuildable` excludes `shelterId`/`foodStoreId`.
- **Reflection voice is first-person & event-weighted (don't revert to summaries):** the prompt
  (`llm/promptBuilder.ts`) demands raw first-person inner voice (name names, blunt) and that a
  death/betrayal/attack dominate the night. The Minds tab shows `reflectionSummary`, so keep it
  first-person. `eventsBlock` sorts the agent's feed by `emotionalWeight` and marks heavy events ‼️
  so a death isn't crowded out by trades.
- **Deaths must reach survivors' reflections:** the LLM only sees `dailyAgentEvents[agentId]`, NOT
  memories — so `lifecycle.killAgent` pushes a weighted death entry into each bereaved survivor's feed
  and sets their `pendingMajorEvent`. If you add a major event, push it to the affected agents' feeds
  too or the mind layer won't know it happened.

## Key tuning constants (top of the named file)
- `decisionEngine.ts`: `SHELTER_CAPACITY` (1 = one villager per hut), `GRANARY_CAPACITY`,
  `GRANARY_WOOD_COST`, `FOOD_KEEP`, `underGranaryCap`, `shortBonus` (housing-shortage ramp).
  Also `autoConsume` relief-per-food (24 — deliberately low so food is a recurring chore, not a
  one-shot; this is a primary scarcity lever, see below).
- `tick.ts`: `PACK_FOOD_SPOIL` / `GRANARY_FOOD_SPOIL` (per-day, applied at dawn in `spoilFood`).
- `seasons.ts`: `SEASON_LENGTH_DAYS` (7), `SEASON_REGEN_MUL` (spring 1.3 → winter 0.25) — the
  boom-and-famine cycle. Season is derived from `world.day` (no stored state); gated by
  `config.seasonsEnabled`. Applied in `resources.ts` `regenerateResources`.
- `world.ts` `generateTiles`: food-patch **density** and per-tile **regen rate** (deliberately lean —
  food is the resource the village competes over).
- `config/defaultConfig.ts`: `ticksPerDay` (default 600), need-decay rates (default `hungerRate` 20,
  slider to 120), reproduction rules, `seasonsEnabled` (default true).
- `events.ts`: `MAX_CHATTER` (narrative events are never trimmed — `isNarrative`).

## Food scarcity / challenge (tuned: tense but survivable; see HANDOVER §6)
Food is intentionally the scarce, contested resource — that scarcity is what drives hunger-theft →
resentment → feuds → violence. If you make food abundant again, conflict evaporates. The levers, in
order of impact: (1) `world.ts` food density + per-tile regen, (2) `autoConsume` relief-per-food in
`decisionEngine.ts`, (3) `config.hungerRate`, (4) `SEASON_REGEN_MUL` winter depth. At default
`hungerRate` the seed survives (~10–12 alive, some combat, no starvation); at the slider max (120) it
collapses into starvation + murder. Re-run `npm run smoke` after touching any of these.
