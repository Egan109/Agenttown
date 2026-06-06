import type { AgentSkills, SkillKey } from "../types";
import { clamp100 } from "../util/math";
import type { Rng } from "../util/rng";

export const SKILL_KEYS: SkillKey[] = [
  "farming",
  "hunting",
  "building",
  "medicine",
  "negotiation",
  "combat",
  "teaching",
  "crafting",
  "leadership",
  "scouting",
];

export function defaultSkills(): AgentSkills {
  const s = {} as AgentSkills;
  for (const k of SKILL_KEYS) s[k] = 10;
  return s;
}

export function makeSkills(overrides: Partial<AgentSkills>): AgentSkills {
  return { ...defaultSkills(), ...overrides };
}

/**
 * Skills improve slowly with use, with diminishing returns near the top. Call
 * this whenever an agent performs an action that exercises a skill.
 */
export function practiceSkill(skills: AgentSkills, key: SkillKey, intensity = 1): void {
  const cur = skills[key];
  // Higher skill -> smaller gains. Roughly logarithmic growth.
  const gain = (intensity * (100 - cur)) / 220;
  skills[key] = clamp100(cur + gain);
}

/** Children inherit a fraction of caregivers' skills, dampened. */
export function inheritSkills(
  caregivers: AgentSkills[],
  rng: Rng,
  inheritanceStrength: number
): AgentSkills {
  const s = defaultSkills();
  if (caregivers.length === 0) return s;
  for (const k of SKILL_KEYS) {
    const avg = caregivers.reduce((a, c) => a + c[k], 0) / caregivers.length;
    // Children start low but lean toward what their caregivers were good at.
    s[k] = clamp100(Math.round(10 + avg * 0.25 * inheritanceStrength + rng.jitter(5)));
  }
  return s;
}
