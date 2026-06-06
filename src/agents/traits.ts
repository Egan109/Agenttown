import type { AgentTraits, TraitKey } from "../types";
import { clamp100 } from "../util/math";
import type { Rng } from "../util/rng";

export const TRAIT_KEYS: TraitKey[] = [
  "intelligence",
  "wisdom",
  "curiosity",
  "creativity",
  "empathy",
  "charisma",
  "honesty",
  "loyalty",
  "forgiveness",
  "manipulativeness",
  "aggression",
  "courage",
  "intimidation",
  "dominance",
  "submissiveness",
  "vengeance",
  "industriousness",
  "discipline",
  "patience",
  "adaptability",
  "riskTolerance",
  "resourcefulness",
  "greed",
  "steadfastness",
  "emotionalStability",
  "impulsiveness",
  "anxiety",
  "pride",
  "leadership",
  "cooperation",
  "fairness",
  "ambition",
  "conformity",
];

export const TRAIT_GROUPS: { label: string; keys: TraitKey[] }[] = [
  { label: "Thinking", keys: ["intelligence", "wisdom", "curiosity", "creativity"] },
  {
    label: "Social",
    keys: ["empathy", "charisma", "honesty", "loyalty", "forgiveness", "manipulativeness"],
  },
  {
    label: "Power & Conflict",
    keys: ["aggression", "courage", "intimidation", "dominance", "submissiveness", "vengeance"],
  },
  {
    label: "Work & Survival",
    keys: [
      "industriousness",
      "discipline",
      "patience",
      "adaptability",
      "riskTolerance",
      "resourcefulness",
      "greed",
    ],
  },
  {
    label: "Emotional",
    keys: ["steadfastness", "emotionalStability", "impulsiveness", "anxiety", "pride"],
  },
  {
    label: "Society & Governance",
    keys: ["leadership", "cooperation", "fairness", "ambition", "conformity"],
  },
];

export function defaultTraits(): AgentTraits {
  const t = {} as AgentTraits;
  for (const k of TRAIT_KEYS) t[k] = 50;
  return t;
}

export function randomTraits(rng: Rng): AgentTraits {
  const t = {} as AgentTraits;
  for (const k of TRAIT_KEYS) t[k] = rng.int(15, 85);
  return t;
}

/** Build a trait block from partial overrides on top of an even baseline. */
export function makeTraits(overrides: Partial<AgentTraits>): AgentTraits {
  return { ...defaultTraits(), ...overrides };
}

/**
 * Inherit traits from one or two parents and apply mutation. Inheritance
 * strength controls how tightly the child tracks the parental average; mutation
 * rate widens the random jitter applied afterward.
 */
export function inheritTraits(
  parents: AgentTraits[],
  rng: Rng,
  inheritanceStrength: number,
  mutationRate: number
): AgentTraits {
  const t = {} as AgentTraits;
  for (const k of TRAIT_KEYS) {
    const parentAvg =
      parents.reduce((s, p) => s + p[k], 0) / Math.max(1, parents.length);
    // Pull toward a neutral 50 by (1 - strength), then add mutation jitter.
    const base = parentAvg * inheritanceStrength + 50 * (1 - inheritanceStrength);
    const mutation = rng.jitter(40 * mutationRate);
    t[k] = clamp100(Math.round(base + mutation));
  }
  return t;
}
