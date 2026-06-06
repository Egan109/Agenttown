import type { Agent, AgentNeeds, NeedKey, SimulationConfig } from "../types";
import { clamp100 } from "../util/math";

export const NEED_KEYS: NeedKey[] = [
  "hunger",
  "thirst",
  "hygiene",
  "energy",
  "shelter",
  "safety",
  "social",
  "reproduction",
];

export function defaultNeeds(): AgentNeeds {
  return {
    hunger: 20,
    thirst: 20,
    hygiene: 15,
    energy: 15,
    shelter: 40,
    safety: 20,
    social: 25,
    reproduction: 10,
  };
}

/**
 * Per-tick passive decay of needs (everything drifts toward "worse"). Rates are
 * expressed per-day in the config and divided across the day's ticks. Some needs
 * (safety, shelter, reproduction) are recomputed elsewhere from the environment;
 * here we only apply the steady physiological drift.
 */
export function decayNeeds(agent: Agent, config: SimulationConfig): void {
  const per = (ratePerDay: number) => ratePerDay / config.ticksPerDay;
  const n = agent.needs;
  n.hunger = clamp100(n.hunger + per(config.hungerRate));
  n.thirst = clamp100(n.thirst + per(config.thirstRate));
  n.hygiene = clamp100(n.hygiene + per(config.hygieneDecayRate));
  // Energy drains slowly just from being awake; work drains it more (handled in actions).
  n.energy = clamp100(n.energy + per(config.energyDecayRate * 0.5));
  n.social = clamp100(n.social + per(config.socialDecayRate));

  // Reproduction drive grows with age window and is modulated by trait ambition.
  const inWindow = agent.age >= 16 && agent.age <= 120;
  if (inWindow) {
    const driveGain = per(2 + agent.traits.ambition * 0.02);
    n.reproduction = clamp100(n.reproduction + driveGain);
  }
}

/**
 * Needs that are very high inflict health damage (starvation, dehydration,
 * exposure, exhaustion). Returns the damage applied so callers can log deaths.
 */
export function applyNeedHealthEffects(agent: Agent): number {
  const n = agent.needs;
  let damage = 0;
  if (n.thirst > 90) damage += (n.thirst - 90) * 0.25;
  if (n.hunger > 90) damage += (n.hunger - 90) * 0.18;
  if (n.energy > 95) damage += (n.energy - 95) * 0.1;
  if (n.shelter > 96) damage += 0.3; // exposure
  if (n.hygiene > 95) damage += 0.2; // sickness from filth
  if (damage > 0) {
    agent.health = clamp100(agent.health - damage);
  } else if (n.hunger < 40 && n.thirst < 40 && agent.health < 100) {
    // Gentle natural healing when fed, watered and not in crisis.
    agent.health = clamp100(agent.health + 0.15);
  }
  return damage;
}

/** A single 0..100 "distress" reading used for emotion/health heuristics. */
export function overallDistress(needs: AgentNeeds): number {
  return clamp100(
    needs.hunger * 0.25 +
      needs.thirst * 0.25 +
      needs.safety * 0.2 +
      needs.energy * 0.1 +
      needs.shelter * 0.1 +
      needs.social * 0.1
  );
}
