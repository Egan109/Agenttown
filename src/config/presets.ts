import type { SimulationConfig, WorldPresetName } from "../types";
import { cloneConfig, defaultConfig } from "./defaultConfig";

/**
 * Presets are partial overrides applied on top of defaultConfig. They tune the
 * starting conditions (resource abundance, decay rates, world size, population)
 * so the same agents and rules produce very different societies.
 */
export const PRESET_NAMES: WorldPresetName[] = [
  "Abundant Paradise",
  "Balanced Village",
  "Harsh Survival",
  "Drought",
  "Winter",
  "Post-Collapse",
  "Tiny Island",
  "Overcrowded World",
];

const PRESET_OVERRIDES: Record<WorldPresetName, Partial<SimulationConfig>> = {
  "Abundant Paradise": {
    resourceScarcity: 0.95,
    resourceRegenerationRate: 2.2,
    startingFood: 500,
    startingWater: 500,
    hungerRate: 8,
    thirstRate: 10,
    seasonsEnabled: false, // a frictionless world: no famine winters
  },
  "Balanced Village": {
    // The default config IS the balanced village.
  },
  "Harsh Survival": {
    resourceScarcity: 0.22,
    resourceRegenerationRate: 0.5,
    startingFood: 90,
    startingWater: 90,
    hungerRate: 16,
    thirstRate: 20,
  },
  Drought: {
    resourceScarcity: 0.35,
    resourceRegenerationRate: 0.3,
    startingWater: 50,
    thirstRate: 26,
    hungerRate: 12,
  },
  Winter: {
    resourceScarcity: 0.3,
    resourceRegenerationRate: 0.35,
    startingFood: 110,
    energyDecayRate: 20,
    hygieneDecayRate: 6,
    hungerRate: 17,
  },
  "Post-Collapse": {
    resourceScarcity: 0.18,
    resourceRegenerationRate: 0.6,
    startingFood: 70,
    startingWater: 70,
    startingWood: 40,
    startingAgentCount: 6,
    hungerRate: 15,
    thirstRate: 18,
  },
  "Tiny Island": {
    worldWidth: 18,
    worldHeight: 14,
    startingAgentCount: 5,
    maxAgents: 24,
    resourceScarcity: 0.5,
  },
  "Overcrowded World": {
    worldWidth: 28,
    worldHeight: 22,
    startingAgentCount: 16,
    maxAgents: 80,
    resourceScarcity: 0.4,
    resourceRegenerationRate: 0.8,
  },
};

export function applyPreset(
  base: SimulationConfig,
  name: WorldPresetName
): SimulationConfig {
  const next = cloneConfig(base);
  const overrides = PRESET_OVERRIDES[name];
  Object.assign(next, overrides);
  // Presets must not clobber the user's LLM choices; reapply them.
  next.llm = cloneConfig(base).llm;
  return next;
}

export function configForPreset(name: WorldPresetName): SimulationConfig {
  return applyPreset(defaultConfig, name);
}
