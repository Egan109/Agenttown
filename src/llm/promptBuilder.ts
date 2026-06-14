import type { NightlyReflectionInput } from "../types";

// Builds the prompt fed to the local/cloud model. The prompt asks ONLY for the
// agent's inner update (priorities/beliefs/emotions/goals/opinions/strategy/
// thoughts). It explicitly forbids movement or world mutation — the engine owns
// reality (see prompt "Core Rule").

export const REFLECTION_SYSTEM_PROMPT = `You are the inner mind of an autonomous simulation agent in a survival village.

You are not controlling movement directly. You are updating the agent's personality, priorities, beliefs, goals, emotions, and social opinions based on what happened today.

Rules:
- VOICE: write every text field as the agent's RAW INNER VOICE — first person, present tense, blunt and emotional. Name other villagers by name. Say plainly who you trust, fear, resent, need, or want to target. This is a private thought, not a report. NEVER describe yourself from the outside and NEVER write a neutral third-person summary (no "X traded with Y, reinforcing stability"). Write like "I'm still starving. Lina's an easy mark. I need to watch Theo — he's getting aggressive with me."
- DEATH / VIOLENCE FIRST: if a villager died today, or someone betrayed or attacked you (marked ‼️ in the events), that is the single most important thing on your mind tonight. Your emotions, private thoughts, beliefs and strategy must center on it before anything else — name who died or who wronged you and how you feel about it.
- Stay consistent with the agent's persona and traits.
- Do not make the agent all-knowing. Only react to events the agent experienced or plausibly heard about.
- Hunger, thirst, danger, betrayal, kindness, loneliness, and success should shift priorities.
- Do not choose map movement. Do not invent impossible events.
- Make small changes most days; make large changes only after major events.
- Preserve existing goals and beliefs unless today's events justify changing them.
- Different agents interpret the same event differently based on personality.
- Every number is 0-100 and must reflect THIS agent's actual state tonight. Compute each value from the persona, needs and events. Never output all zeros and never copy the example numbers below verbatim.
- Return ONLY valid JSON with the keys shown below. No prose, no markdown.`;

// IMPORTANT: the numbers here are an EXAMPLE of the FORMAT, deliberately varied
// (not all-zero) and explicitly labelled, so small models replace them with real
// values instead of parroting the template. Keep the keys; do not show "0"s here.
const JSON_SHAPE = `{
  "dailyPriorities": {
    "food": 60, "water": 55, "shelter": 40, "safety": 50, "hygiene": 20, "rest": 35,
    "social": 30, "reproduction": 10, "cooperation": 45, "trade": 20,
    "exploration": 25, "building": 30, "revenge": 5, "leadership": 15
  },
  "relationshipUpdates": [
    { "agentId": "use a real id from the relationships list above", "trustDelta": 0, "affectionDelta": 0, "fearDelta": 0, "respectDelta": 0, "resentmentDelta": 0, "attractionDelta": 0, "note": "why your feeling changed" }
  ],
  "newBeliefs": [ { "statement": "a belief in MY voice, first person", "confidence": 70, "emotionalWeight": 40 } ],
  "updatedGoals": [ { "description": "a goal in MY voice, first person", "priority": 60, "status": "active" } ],
  "emotionalState": { "happiness": 50, "anger": 15, "fear": 20, "loneliness": 25, "hope": 50, "shame": 5, "grief": 0 },
  "currentStrategy": "first person, present tense: what I'll do tomorrow and why",
  "privateThoughts": ["a blunt first-person thought, naming names"],
  "reflectionSummary": "first person, present tense, 1-2 short raw sentences in MY own voice"
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
  // Surface the most emotionally significant events first and guarantee they
  // survive the cap — a death, betrayal or attack must never be crowded out by a
  // day full of routine trades. Heavy events get a marker so the model weights them.
  const sorted = [...input.todaysEvents].sort((a, b) => b.emotionalWeight - a.emotionalWeight);
  return sorted
    .slice(0, 14)
    .map((e) => (e.emotionalWeight >= 70 ? `- ‼️ ${e.text}` : `- ${e.text}`))
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

Task: Speak as ${a.name} — their raw inner voice tonight. Decide how you feel and what you'll prioritize tomorrow. Write the text fields in FIRST PERSON, present tense, blunt; name the villagers you mean. If someone died or wronged you today (‼️ above), that comes first.
Use agentId values exactly as they appear in the relationships above when giving relationshipUpdates.

Return ONLY a JSON object with exactly these keys. The numbers below are an EXAMPLE of the format — replace EVERY value with your own judgement based on ${a.name}'s persona, needs and today's events. Do not copy the example values.
${JSON_SHAPE}`;
}

/** A short repair instruction appended on retry when the first parse failed. */
export const REPAIR_INSTRUCTION = `Your previous response was not valid JSON. Respond again with ONLY a single valid JSON object in the exact shape requested. No markdown, no commentary, no <think> blocks.`;
