import { z } from "zod";
import type { NightlyReflectionOutput } from "../types";

// Small local models return messy JSON. These schemas are deliberately lenient:
// every numeric field is coerced + clamped, unknown fields are stripped, and
// missing fields fall back to safe defaults via `.catch()`. The goal is to
// extract *something usable* whenever possible and let the deterministic
// fallback handle the truly broken cases.

const clampedNumber = (min: number, max: number, fallback: number) =>
  z.coerce
    .number()
    .transform((v) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback))
    .catch(fallback);

const score100 = (fallback = 50) => clampedNumber(0, 100, fallback);
const delta = (fallback = 0) => clampedNumber(-100, 100, fallback);

export const dailyPrioritiesSchema = z
  .object({
    food: score100(),
    water: score100(),
    shelter: score100(),
    safety: score100(),
    hygiene: score100(),
    rest: score100(),
    social: score100(),
    reproduction: score100(),
    cooperation: score100(),
    trade: score100(),
    exploration: score100(),
    building: score100(),
    revenge: score100(0),
    leadership: score100(),
  })
  .partial()
  .catch({});

export const relationshipUpdateSchema = z.object({
  agentId: z.string(),
  trustDelta: delta().optional(),
  affectionDelta: delta().optional(),
  fearDelta: delta().optional(),
  respectDelta: delta().optional(),
  resentmentDelta: delta().optional(),
  attractionDelta: delta().optional(),
  note: z.string().catch("").default(""),
});

export const beliefSchema = z.object({
  statement: z.string().min(1),
  confidence: score100(50),
  emotionalWeight: score100(40),
});

export const goalSchema = z.object({
  description: z.string().min(1),
  priority: score100(50),
  status: z
    .enum(["active", "paused", "completed", "abandoned"])
    .catch("active"),
});

export const emotionalStateSchema = z
  .object({
    happiness: score100(),
    anger: score100(10),
    fear: score100(15),
    loneliness: score100(20),
    hope: score100(),
    shame: score100(5),
    grief: score100(0),
  })
  .partial()
  .catch({});

export const nightlyReflectionOutputSchema = z.object({
  dailyPriorities: dailyPrioritiesSchema.optional(),
  relationshipUpdates: z.array(relationshipUpdateSchema).catch([]).default([]),
  newBeliefs: z.array(beliefSchema).catch([]).default([]),
  updatedGoals: z.array(goalSchema).catch([]).default([]),
  emotionalState: emotionalStateSchema.optional(),
  currentStrategy: z.string().catch("").default(""),
  privateThoughts: z.array(z.string()).catch([]).default([]),
  reflectionSummary: z.string().catch("").default(""),
});

export type ParsedReflection = z.infer<typeof nightlyReflectionOutputSchema>;

export const batchReflectionOutputSchema = z.object({
  reflections: z
    .array(
      z.object({
        agentId: z.string(),
        output: nightlyReflectionOutputSchema,
      })
    )
    .catch([])
    .default([]),
});

/**
 * Validate + normalize raw parsed JSON into a fully-populated reflection output.
 * Returns null only if the input is so broken that even Zod's lenient parse
 * fails (e.g. not an object at all).
 */
export function normalizeReflection(raw: unknown): NightlyReflectionOutput | null {
  const parsed = nightlyReflectionOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    dailyPriorities: {
      food: 50, water: 50, shelter: 40, safety: 45, hygiene: 25, rest: 35,
      social: 35, reproduction: 15, cooperation: 40, trade: 20, exploration: 25,
      building: 30, revenge: 5, leadership: 15,
      ...(r.dailyPriorities ?? {}),
    },
    relationshipUpdates: r.relationshipUpdates ?? [],
    newBeliefs: r.newBeliefs ?? [],
    updatedGoals: r.updatedGoals ?? [],
    emotionalState: {
      happiness: 55, anger: 10, fear: 15, loneliness: 20, hope: 55, shame: 5, grief: 0,
      ...(r.emotionalState ?? {}),
    },
    currentStrategy: r.currentStrategy || "Carry on as before.",
    privateThoughts: r.privateThoughts ?? [],
    reflectionSummary: r.reflectionSummary || "",
  };
}
