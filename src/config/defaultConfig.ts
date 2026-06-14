import type { LLMConfig, ReproductionRules, SimulationConfig } from "../types";

export const defaultLLMConfig: LLMConfig = {
  enabled: true,
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "qwen3:4b",

  reflectionMode: "major_events_only",
  maxAgentsPerBatch: 8,
  reflectEveryNDays: 3,

  useCloudForMajorEvents: false,
  localModel: "qwen3:4b",
  cloudModel: "claude-sonnet-4-6",
  apiKey: "",

  think: false,

  temperature: 0.7,
  maxTokens: 800,
  timeoutMs: 30000,
};

export const defaultReproductionRules: ReproductionRules = {
  requiredParticipants: 2,
  requiredGenders: undefined,
  allowSameGender: true,
  allowAsexual: false,
  minimumAge: 18,
  maximumAge: 120,
  requiresShelter: false,
  requiresFoodSurplus: true,
  childCreationCost: { food: 8, water: 6, energy: 25 },
  cooldownDays: 6,
};

export const defaultConfig: SimulationConfig = {
  worldWidth: 32,
  worldHeight: 24,
  startingAgentCount: 8,
  maxAgents: 60,

  startingFood: 220,
  startingWater: 220,
  startingWood: 140,
  startingStone: 90,
  startingMedicine: 30,

  resourceScarcity: 0.5,
  resourceRegenerationRate: 1,

  hungerRate: 20,
  thirstRate: 16,
  hygieneDecayRate: 8,
  energyDecayRate: 14,
  socialDecayRate: 9,

  reproductionEnabled: true,
  reproductionRules: defaultReproductionRules,

  conflictEnabled: true,
  violenceEnabled: true,
  diplomacyEnabled: true,
  tradingEnabled: true,
  stealingEnabled: true,

  diseaseEnabled: false,
  weatherEnabled: false,
  disastersEnabled: false,

  // Seasonal boom-and-famine: cycles food (and other renewable) regen through
  // the year so the village must store surplus in autumn to survive winter.
  seasonsEnabled: true,

  llm: defaultLLMConfig,

  mutationRate: 0.25,
  childInheritanceStrength: 0.7,

  // Longer days = more gameplay between dawns, so the (sim-pausing) nightly
  // reflections interrupt less often. Need-decay rates are per-day, so day length
  // is balance-neutral; it only changes how much you watch between reflections.
  // Set long by default because a real local-LLM dawn can take several seconds
  // per agent and you don't want that pause every few seconds of play. Balance
  // is day-length-neutral (see needs.ts / doRest scaling), so this is purely a
  // pacing choice.
  ticksPerDay: 600,
};

export function cloneConfig(c: SimulationConfig): SimulationConfig {
  return JSON.parse(JSON.stringify(c)) as SimulationConfig;
}
