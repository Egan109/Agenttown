import type {
  DailyPriorities,
  EmotionalState,
  LLMProvider,
  NightlyReflectionInput,
  NightlyReflectionOutput,
} from "../types";
import { clamp100 } from "../util/math";

// The mock provider produces a *deterministic* reflection derived from the
// agent's needs, emotions, traits and the day's events — no network, no model.
// It serves two roles:
//   1. The "no LLM" default so the sim is fully playable out of the box.
//   2. The final fallback when a real LLM is unavailable or returns junk.
// It deliberately makes small, sensible adjustments rather than dramatic ones.

export function deterministicReflection(
  input: NightlyReflectionInput
): NightlyReflectionOutput {
  const { currentState: cs, mind, agent } = input;
  const n = cs.needs;
  const t = agent.traits;

  // Priorities track the most pressing needs, nudged by personality.
  const priorities: DailyPriorities = {
    food: clamp100(40 + n.hunger * 0.6),
    water: clamp100(40 + n.thirst * 0.6),
    shelter: clamp100(25 + n.shelter * 0.5 + t.industriousness * 0.1),
    safety: clamp100(30 + n.safety * 0.6 + t.anxiety * 0.2),
    hygiene: clamp100(15 + n.hygiene * 0.4),
    rest: clamp100(20 + n.energy * 0.5),
    social: clamp100(20 + n.social * 0.5 + t.empathy * 0.1),
    reproduction: clamp100(n.reproduction * 0.5 + t.ambition * 0.1),
    cooperation: clamp100(25 + t.cooperation * 0.4 + t.empathy * 0.2),
    trade: clamp100(15 + t.resourcefulness * 0.3),
    exploration: clamp100(15 + t.curiosity * 0.4),
    building: clamp100(20 + t.industriousness * 0.3 + n.shelter * 0.2),
    revenge: clamp100(maxResentment(input) * 0.6 + t.vengeance * 0.2 - t.forgiveness * 0.3),
    leadership: clamp100(t.leadership * 0.3 + t.ambition * 0.2),
  };

  // Emotions drift toward what the day's events imply.
  const negative = input.todaysEvents.filter((e) =>
    ["attack", "theft", "betrayal", "death"].includes(e.type)
  ).length;
  const positive = input.todaysEvents.filter((e) =>
    ["share", "heal", "trade", "birth", "alliance"].includes(e.type)
  ).length;

  const emo = mind.emotionalState;
  const emotionalState: EmotionalState = {
    happiness: clamp100(emo.happiness + positive * 6 - negative * 8 - (n.hunger > 70 ? 10 : 0)),
    anger: clamp100(emo.anger + negative * 7 - 3),
    fear: clamp100(emo.fear * 0.9 + n.safety * 0.3 + negative * 5),
    loneliness: clamp100(n.social * 0.6 - (input.todaysEvents.length > 0 ? 5 : 0)),
    hope: clamp100(emo.hope + positive * 4 - negative * 5 - (n.hunger > 80 ? 8 : 0)),
    shame: clamp100(emo.shame * 0.85),
    grief: clamp100(emo.grief * 0.9 + deathsOfKnown(input) * 20),
  };

  const strategy = chooseStrategy(input, priorities);

  return {
    dailyPriorities: priorities,
    relationshipUpdates: [], // mechanical relationships already handle this path
    newBeliefs: [],
    updatedGoals: mind.goals.filter((g) => g.status === "active").slice(0, 4),
    emotionalState,
    currentStrategy: strategy,
    privateThoughts: [summarize(input)],
    reflectionSummary: summarize(input),
  };
}

function maxResentment(input: NightlyReflectionInput): number {
  let m = 0;
  for (const op of Object.values(input.relationships)) m = Math.max(m, op.resentment);
  return m;
}

function deathsOfKnown(input: NightlyReflectionInput): number {
  return input.todaysEvents.filter((e) => e.type === "death").length;
}

function chooseStrategy(input: NightlyReflectionInput, p: DailyPriorities): string {
  const top = (Object.entries(p) as [string, number][]).sort((a, b) => b[1] - a[1])[0];
  switch (top[0]) {
    case "food":
      return "Tomorrow I must find food before anything else.";
    case "water":
      return "I need to secure water; thirst is dangerous.";
    case "safety":
      return "Stay near allies and away from those I fear.";
    case "revenge":
      return "I have not forgotten what was done to me.";
    case "building":
      return "Gather materials and raise a shelter.";
    case "cooperation":
      return "Work with others; we survive together.";
    case "reproduction":
      return "I would like to start a family if I find the right partner.";
    default:
      return input.mind.currentStrategy || "Survive, and watch the others.";
  }
}

function summarize(input: NightlyReflectionInput): string {
  if (input.todaysEvents.length === 0) {
    return `${input.agent.name} had a quiet day.`;
  }
  const e = input.todaysEvents[input.todaysEvents.length - 1];
  return `${input.agent.name}: ${e.text}`;
}

export function makeMockProvider(): LLMProvider {
  return {
    name: "mock",
    generateReflection: async (input) => deterministicReflection(input),
  };
}
