import type { NightlyReflectionInput } from "../types";

// Builds the prompt fed to the local/cloud model. The prompt asks ONLY for the
// agent's inner update (priorities/beliefs/emotions/goals/opinions/strategy/
// thoughts). It explicitly forbids movement or world mutation — the engine owns
// reality (see prompt "Core Rule").

export const REFLECTION_SYSTEM_PROMPT = `You are the inner mind of an autonomous simulation agent in a survival village.

You are not controlling movement directly. You are updating the agent's personality, priorities, beliefs, goals, emotions, and social opinions based on what happened today.

Rules:
- Stay consistent with the agent's persona and traits.
- Do not make the agent all-knowing. Only react to events the agent experienced or plausibly heard about.
- Hunger, thirst, danger, betrayal, kindness, loneliness, and success should shift priorities.
- Do not choose map movement. Do not invent impossible events.
- Make small changes most days; make large changes only after major events.
- Preserve existing goals and beliefs unless today's events justify changing them.
- Different agents interpret the same event differently based on personality.
- Return ONLY valid JSON in the exact shape requested. No prose, no markdown.`;

const JSON_SHAPE = `{
  "dailyPriorities": {
    "food": 0, "water": 0, "shelter": 0, "safety": 0, "hygiene": 0, "rest": 0,
    "social": 0, "reproduction": 0, "cooperation": 0, "trade": 0,
    "exploration": 0, "building": 0, "revenge": 0, "leadership": 0
  },
  "relationshipUpdates": [
    { "agentId": "string", "trustDelta": 0, "affectionDelta": 0, "fearDelta": 0, "respectDelta": 0, "resentmentDelta": 0, "attractionDelta": 0, "note": "string" }
  ],
  "newBeliefs": [ { "statement": "string", "confidence": 0, "emotionalWeight": 0 } ],
  "updatedGoals": [ { "description": "string", "priority": 0, "status": "active" } ],
  "emotionalState": { "happiness": 0, "anger": 0, "fear": 0, "loneliness": 0, "hope": 0, "shame": 0, "grief": 0 },
  "currentStrategy": "string",
  "privateThoughts": ["string"],
  "reflectionSummary": "string"
}`;

function topTraits(traits: Record<string, number>, n: number): string {
  return Object.entries(traits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

function relationshipsBlock(input: NightlyReflectionInput): string {
  const entries = Object.entries(input.relationships);
  if (entries.length === 0) return "(no notable relationships yet)";
  return entries
    .slice(0, 10)
    .map(([id, op]) => {
      const name = input.agentNames[id] ?? id;
      return `- ${name}: trust ${op.trust}, affection ${op.affection}, fear ${op.fear}, respect ${op.respect}, resentment ${op.resentment}`;
    })
    .join("\n");
}

function eventsBlock(input: NightlyReflectionInput): string {
  if (input.todaysEvents.length === 0) return "(an uneventful day)";
  return input.todaysEvents
    .slice(-14)
    .map((e) => `- ${e.text}`)
    .join("\n");
}

export function buildReflectionUserPrompt(input: NightlyReflectionInput): string {
  const a = input.agent;
  const cs = input.currentState;
  const m = input.mind;
  const w = input.worldSummary;
  return `Agent: ${a.name} (age ${a.age}${a.gender ? ", " + a.gender : ""})

Persona: ${a.persona}

Dominant traits: ${topTraits(a.traits as unknown as Record<string, number>, 8)}
Top skills: ${topTraits(a.skills as unknown as Record<string, number>, 4)}

Current needs (0=fine, 100=critical): hunger ${Math.round(cs.needs.hunger)}, thirst ${Math.round(
    cs.needs.thirst
  )}, energy ${Math.round(cs.needs.energy)}, hygiene ${Math.round(cs.needs.hygiene)}, shelter ${Math.round(
    cs.needs.shelter
  )}, safety ${Math.round(cs.needs.safety)}, social ${Math.round(cs.needs.social)}.
Health: ${Math.round(cs.health)}. Inventory: ${
    Object.entries(cs.inventory)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ") || "empty"
  }.
Location: ${cs.locationSummary}

Current emotional state: happiness ${Math.round(m.emotionalState.happiness)}, anger ${Math.round(
    m.emotionalState.anger
  )}, fear ${Math.round(m.emotionalState.fear)}, loneliness ${Math.round(
    m.emotionalState.loneliness
  )}, hope ${Math.round(m.emotionalState.hope)}, grief ${Math.round(m.emotionalState.grief)}.

Current strategy: ${m.currentStrategy}
Current beliefs: ${m.beliefs.map((b) => b.statement).join("; ") || "(none)"}
Current goals: ${m.goals
    .filter((g) => g.status === "active")
    .map((g) => g.description)
    .join("; ") || "(none)"}

Relationships:
${relationshipsBlock(input)}

What happened to ${a.name} today:
${eventsBlock(input)}

World situation: population ${w.population}, food scarcity ${w.foodScarcity.toFixed(
    2
  )}, water scarcity ${w.waterScarcity.toFixed(2)}, danger ${w.dangerLevel.toFixed(
    2
  )}, deaths today ${w.deathsToday}, births today ${w.birthsToday}, conflicts today ${w.conflictsToday}.

Task: Decide how ${a.name} feels tonight and what they will prioritize tomorrow.
Use agentId values exactly as they appear in the relationships above when giving relationshipUpdates.

Return ONLY JSON in this exact shape:
${JSON_SHAPE}`;
}

/** A short repair instruction appended on retry when the first parse failed. */
export const REPAIR_INSTRUCTION = `Your previous response was not valid JSON. Respond again with ONLY a single valid JSON object in the exact shape requested. No markdown, no commentary, no <think> blocks.`;
