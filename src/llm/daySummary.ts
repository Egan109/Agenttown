import type {
  DailySummary,
  LLMConfig,
  LLMProvider,
  WorldEvent,
  WorldState,
} from "../types";
import { livingAgents } from "../simulation/world";
import { parseLooseJson } from "./repairJson";

// ---------------------------------------------------------------------------
// The village "chronicle": a daily summary woven from the agents' reflections
// (their thoughts) plus the day's notable world events. This is a *narrative*
// view only — like the reflections themselves, it never touches world state.
// ---------------------------------------------------------------------------

const MAX_SUMMARIES = 120;

/** One agent's reflection, as collected by the orchestrator. */
export type ReflectionDigest = {
  name: string;
  summary: string;
};

export type DaySummaryInput = {
  day: number;
  population: number;
  births: number;
  deaths: number;
  conflicts: number;
  reflections: ReflectionDigest[];
  /** Notable world-log lines from the day being summarized. */
  notableEvents: string[];
};

// World-event types worth putting in the chronicle (skip chatter/reflection lines).
const NOTABLE_TYPES: ReadonlySet<WorldEvent["type"]> = new Set([
  "birth",
  "death",
  "attack",
  "theft",
  "betrayal",
  "rescue",
  "heal",
  "shelter_built",
  "alliance",
  "group_formed",
  "reproduction",
  "shortage",
  "law_proposed",
  "law_broken",
]);

/**
 * Collect everything the chronicle needs. Pulls notable world events for the day
 * that just ended (world.day was already advanced at dawn, so that is day-1).
 */
export function buildDaySummaryInput(
  world: WorldState,
  reflections: ReflectionDigest[]
): DaySummaryInput {
  const day = world.day - 1;
  const notableEvents = world.events
    .filter((e) => e.day === day && NOTABLE_TYPES.has(e.type))
    .slice(-20)
    .map((e) => e.text);

  // Stats for the summarized day are captured in the dawn books before the reset,
  // so we re-read them here from the running counters where still valid; deaths/
  // births/conflicts for the summarized day come from the events themselves.
  const counts = countFromEvents(world, day);

  return {
    day,
    population: livingAgents(world).length,
    births: counts.births,
    deaths: counts.deaths,
    conflicts: counts.conflicts,
    reflections,
    notableEvents,
  };
}

function countFromEvents(
  world: WorldState,
  day: number
): { births: number; deaths: number; conflicts: number } {
  let births = 0;
  let deaths = 0;
  let conflicts = 0;
  for (const e of world.events) {
    if (e.day !== day) continue;
    if (e.type === "birth" || e.type === "reproduction") births++;
    else if (e.type === "death") deaths++;
    else if (e.type === "attack") conflicts++;
  }
  return { births, deaths, conflicts };
}

// ---------------------------------------------------------------------------
// Deterministic fallback (no LLM, or on provider error)
// ---------------------------------------------------------------------------

export function deterministicDaySummary(input: DaySummaryInput): DailySummary {
  const headlines = buildHeadlines(input);
  const moodLine =
    input.reflections.length > 0
      ? `${input.reflections.length} villager${input.reflections.length === 1 ? "" : "s"} took stock of the day.`
      : "The village kept to its routines.";

  const pieces: string[] = [];
  pieces.push(
    `Day ${input.day}: ${input.population} alive` +
      (input.births ? `, ${input.births} born` : "") +
      (input.deaths ? `, ${input.deaths} lost` : "") +
      (input.conflicts ? `, ${input.conflicts} clash${input.conflicts === 1 ? "" : "es"}` : "") +
      "."
  );
  pieces.push(moodLine);
  // Fold in a couple of the most evocative reflection lines verbatim.
  for (const r of input.reflections.slice(0, 3)) {
    if (r.summary) pieces.push(`${r.name}: ${r.summary}`);
  }

  return {
    day: input.day,
    text: pieces.join(" "),
    headlines,
    population: input.population,
    births: input.births,
    deaths: input.deaths,
    conflicts: input.conflicts,
    reflectionCount: input.reflections.length,
    fellBack: true,
  };
}

function buildHeadlines(input: DaySummaryInput): string[] {
  const out: string[] = [];
  for (const text of input.notableEvents.slice(0, 6)) out.push(text);
  if (out.length === 0 && input.reflections[0]?.summary) {
    out.push(input.reflections[0].summary);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompted (LLM) chronicle
// ---------------------------------------------------------------------------

// The chronicle is requested as JSON (not prose) on purpose: hybrid models like
// qwen3 leak their chain-of-thought into free-form output, but JSON mode
// suppresses it (the same reason the reflection path uses format:"json").
const CHRONICLE_SYSTEM_PROMPT = `You are the omniscient narrator of an autonomous survival village. Each night you write a short, vivid chronicle of the day that just passed, drawing on what actually happened and on the villagers' own private reflections.

Rules:
- Summarize ONLY what is given. Do NOT invent events, names, or outcomes.
- Be concrete and grounded: name villagers, note shifts in mood, alliances, feuds, births, deaths.
- Write as a storyteller in the third person, 2-4 sentences. Warm, readable narration.
- Do NOT include your reasoning, planning, or any commentary about the task. Only the chronicle itself.
- Return ONLY a JSON object: {"chronicle": "<the narration>", "headlines": ["<short event headline>", ...]}.
- "chronicle" is the prose; "headlines" is 2-5 terse bullet phrases (e.g. "Orin caught stealing from Mara"). No markdown.`;

const CHRONICLE_JSON_SHAPE = `{
  "chronicle": "A short, third-person story of the day in 2-4 sentences.",
  "headlines": ["a terse event headline", "another headline"]
}`;

function buildChronicleUserPrompt(input: DaySummaryInput): string {
  const events =
    input.notableEvents.length > 0
      ? input.notableEvents.map((e) => `- ${e}`).join("\n")
      : "(a quiet day with no major incidents)";
  const reflections =
    input.reflections.length > 0
      ? input.reflections.map((r) => `- ${r.name}: ${r.summary || "(kept their thoughts private)"}`).join("\n")
      : "(no one reflected tonight)";

  return `Day ${input.day} of the village.
Population alive: ${input.population}. Births: ${input.births}. Deaths: ${input.deaths}. Conflicts: ${input.conflicts}.

What happened today:
${events}

How the villagers felt tonight (their own reflections):
${reflections}

Write the chronicle for Day ${input.day}. Return ONLY a JSON object in exactly this shape:
${CHRONICLE_JSON_SHAPE}`;
}

type ChronicleJson = { chronicle?: unknown; headlines?: unknown };

/**
 * Generate the day's chronicle. Uses the provider's JSON-constrained generation
 * when available; otherwise (mock provider, or any error/parse failure) returns
 * the deterministic narrative so a chronicle always lands.
 */
export async function generateDaySummary(
  world: WorldState,
  reflections: ReflectionDigest[],
  provider: LLMProvider,
  _config: LLMConfig
): Promise<DailySummary> {
  const input = buildDaySummaryInput(world, reflections);
  const fallback = deterministicDaySummary(input);

  if (!provider.generateJson) return fallback;
  try {
    const raw = await provider.generateJson(
      CHRONICLE_SYSTEM_PROMPT,
      buildChronicleUserPrompt(input)
    );
    const parsed = parseLooseJson(raw) as ChronicleJson | null;
    const chronicle = typeof parsed?.chronicle === "string" ? parsed.chronicle.trim() : "";
    if (!chronicle) return fallback;

    const headlines = Array.isArray(parsed?.headlines)
      ? parsed!.headlines
          .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
          .map((h) => h.trim().slice(0, 120))
          .slice(0, 5)
      : fallback.headlines;

    return {
      ...fallback,
      text: chronicle.slice(0, 800),
      headlines: headlines.length > 0 ? headlines : fallback.headlines,
      fellBack: false,
    };
  } catch {
    return fallback;
  }
}

/** Append a chronicle to the world, keeping the list capped. */
export function pushDailySummary(world: WorldState, summary: DailySummary): void {
  world.dailySummaries.push(summary);
  if (world.dailySummaries.length > MAX_SUMMARIES) {
    world.dailySummaries.splice(0, world.dailySummaries.length - MAX_SUMMARIES);
  }
}
