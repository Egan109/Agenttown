// ============================================================================
// AgentTown — Core type definitions
//
// This is the single source of truth for the simulation's data shapes. Logic
// lives in src/agents, src/simulation and src/llm; this file only declares the
// shapes those modules read and write.
//
// Design rule (see prompt "Core Rule"): the simulation engine is reality. The
// LLM may only influence an agent's MIND (priorities, beliefs, emotions, goals,
// social opinions, strategy, private thoughts). It never moves agents, edits the
// map, or creates/destroys resources or lives.
// ============================================================================

// ---------------------------------------------------------------------------
// World & resources
// ---------------------------------------------------------------------------

export type TerrainType =
  | "grass"
  | "water"
  | "forest"
  | "rock"
  | "farm"
  | "house"
  | "empty"
  | "danger";

export type ResourceType =
  | "food"
  | "water"
  | "wood"
  | "stone"
  | "medicine"
  | "tools"
  | "luxury";

export type Resource = {
  type: ResourceType;
  amount: number;
  renewable: boolean;
  regenerationRate?: number;
};

export type Tile = {
  x: number;
  y: number;
  terrain: TerrainType;
  resource?: Resource;
  shelterId?: string;
  /** A communal food store (granary) occupying this tile, if any. */
  foodStoreId?: string;
  walkable: boolean;
};

export type Inventory = Partial<Record<ResourceType, number>>;

export type Position = { x: number; y: number };

export type Shelter = {
  id: string;
  position: Position;
  /** 0..100 — build progress; usable once it reaches 100. */
  progress: number;
  /** 0..100 — structural integrity; can be damaged by disasters/conflict. */
  integrity: number;
  ownerId: string;
  occupantIds: string[];
  /** If owned by a group, only members may shelter here (future: laws). */
  groupId?: string;
};

/**
 * A granary: a communal FOOD store occupying one tile. Distinct from a Shelter
 * (which houses people). Food kept here spoils far slower than food carried in
 * an agent's pack, so the village builds granaries to preserve surplus.
 */
export type FoodStore = {
  id: string;
  position: Position;
  /** 0..100 — build progress; usable once it reaches 100. */
  progress: number;
  /** 0..100 — structural integrity (future: disasters/raids). */
  integrity: number;
  ownerId: string;
  /** Stored food units. */
  food: number;
  /** Max food it can hold. */
  capacity: number;
};

// ---------------------------------------------------------------------------
// Agent: traits, skills, needs
// ---------------------------------------------------------------------------

/** All traits are 0..100 and are meant to be behavior-shaping, not cosmetic. */
export type AgentTraits = {
  // Thinking
  intelligence: number;
  wisdom: number;
  curiosity: number;
  creativity: number;
  // Social
  empathy: number;
  charisma: number;
  honesty: number;
  loyalty: number;
  forgiveness: number;
  manipulativeness: number;
  // Power and conflict
  aggression: number;
  courage: number;
  intimidation: number;
  dominance: number;
  submissiveness: number;
  vengeance: number;
  // Work and survival
  industriousness: number;
  discipline: number;
  patience: number;
  adaptability: number;
  riskTolerance: number;
  resourcefulness: number;
  greed: number;
  // Emotional stability
  steadfastness: number;
  emotionalStability: number;
  impulsiveness: number;
  anxiety: number;
  pride: number;
  // Society and governance
  leadership: number;
  cooperation: number;
  fairness: number;
  ambition: number;
  conformity: number;
};

export type TraitKey = keyof AgentTraits;

export type AgentSkills = {
  farming: number;
  hunting: number;
  building: number;
  medicine: number;
  negotiation: number;
  combat: number;
  teaching: number;
  crafting: number;
  leadership: number;
  scouting: number;
};

export type SkillKey = keyof AgentSkills;

/** Needs are 0..100 where HIGHER = MORE URGENT/worse, except where noted. */
export type AgentNeeds = {
  hunger: number; // 0 fed -> 100 starving
  thirst: number; // 0 hydrated -> 100 parched
  hygiene: number; // 0 clean -> 100 filthy
  energy: number; // 0 rested -> 100 exhausted
  shelter: number; // 0 sheltered -> 100 exposed
  safety: number; // 0 safe -> 100 in danger
  social: number; // 0 connected -> 100 isolated
  reproduction: number; // 0 satisfied -> 100 strong drive
};

export type NeedKey = keyof AgentNeeds;

// ---------------------------------------------------------------------------
// Mind (LLM-influenced)
// ---------------------------------------------------------------------------

export type DailyPriorities = {
  food: number;
  water: number;
  shelter: number;
  safety: number;
  hygiene: number;
  rest: number;
  social: number;
  reproduction: number;
  cooperation: number;
  trade: number;
  exploration: number;
  building: number;
  revenge: number;
  leadership: number;
};

export type PriorityKey = keyof DailyPriorities;

export type SocialOpinion = {
  trust: number; // -100..100
  affection: number; // -100..100
  fear: number; // 0..100
  respect: number; // 0..100
  resentment: number; // 0..100
  attraction: number; // 0..100
  notes: string[];
};

export type Belief = {
  statement: string;
  confidence: number; // 0..100
  emotionalWeight: number; // 0..100
};

export type GoalStatus = "active" | "paused" | "completed" | "abandoned";

export type Goal = {
  description: string;
  priority: number; // 0..100
  status: GoalStatus;
};

export type EmotionalState = {
  happiness: number;
  anger: number;
  fear: number;
  loneliness: number;
  hope: number;
  shame: number;
  grief: number;
};

export type AgentMind = {
  dailyPriorities: DailyPriorities;
  socialOpinions: Record<string, SocialOpinion>;
  beliefs: Belief[];
  goals: Goal[];
  emotionalState: EmotionalState;
  currentStrategy: string;
  privateThoughts: string[];
  lastReflection?: string;
};

// ---------------------------------------------------------------------------
// Memory & relationships
// ---------------------------------------------------------------------------

export type MemoryType =
  | "positive"
  | "negative"
  | "neutral"
  | "trauma"
  | "achievement"
  | "betrayal"
  | "kindness"
  | "conflict"
  | "birth"
  | "death";

export type Memory = {
  tick: number;
  day: number;
  description: string;
  emotionalWeight: number; // 0..100, drives recall & decay resistance
  relatedAgentIds: string[];
  type: MemoryType;
};

/** Mechanical relationship numbers used by the rule engine (fast path). */
export type Relationship = {
  trust: number; // -100..100
  affection: number; // -100..100 (a.k.a. "warmth" socially)
  fear: number; // 0..100
  respect: number; // 0..100
  resentment: number; // 0..100 (a.k.a. "tension" socially)
  attraction: number; // 0..100
  familiarity: number; // 0..100 — how well they know each other (grows with contact)
};

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export type AgentAction =
  | "idle"
  | "move"
  | "explore"
  | "gather_food"
  | "gather_water"
  | "gather_wood"
  | "gather_stone"
  | "build_shelter"
  | "rest"
  | "clean_self"
  | "talk"
  | "trade"
  | "share_resource"
  | "steal"
  | "attack"
  | "flee"
  | "heal"
  | "teach"
  | "craft_tool"
  | "store_food"
  | "get_food"
  | "reproduce"
  | "form_group"
  | "join_group"
  | "leave_group"
  | "propose_law";

export type Agent = {
  id: string;
  name: string;
  age: number; // in days
  gender?: string;
  /** Hex color for rendering, derived from id/persona. */
  color: string;

  position: Position;

  persona: string;
  traits: AgentTraits;
  skills: AgentSkills;
  needs: AgentNeeds;
  inventory: Inventory;

  relationships: Record<string, Relationship>;
  memories: Memory[];

  mind: AgentMind;

  health: number; // 0..100
  alive: boolean;
  causeOfDeath?: string;
  deathDay?: number;
  /** Who last attacked this agent, and when — so a death from combat wounds a few
   *  ticks later is still attributed to the attacker (feeds the killer-feud logic). */
  lastAttackerId?: string;
  lastAttackTick?: number;

  currentGoal?: string;
  currentAction?: AgentAction;
  currentTargetAgentId?: string;
  currentTargetPosition?: Position;

  /** Path the rule engine is currently following (tile coords). */
  path?: Position[];

  familyIds: string[];
  groupIds: string[];

  /** Bookkeeping for reflection scheduling. */
  lastReflectionDay: number;
  pendingMajorEvent: boolean;

  /** Recent-conversation memory for the deterministic social system (anti-repetition). */
  social?: AgentSocialState;
};

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

export type MessageType =
  | "greeting"
  | "request_resource"
  | "offer_trade"
  | "warning"
  | "threat"
  | "proposal"
  | "confession"
  | "gossip"
  | "alliance_offer"
  | "reproduction_proposal"
  | "law_proposal"
  | "apology";

export type Message = {
  fromAgentId: string;
  toAgentId: string;
  type: MessageType;
  /** Finer-grained social intent (deterministic social system); optional so older
   *  message producers (reproduction/group proposals) need not set it. */
  intent?: SocialIntent;
  content: string;
  tick: number;
  day: number;
};

/** Deterministic conversational intents chosen by the social system (social.ts). */
export type SocialIntent =
  | "greet"
  | "share_idea"
  | "ask_for_help"
  | "share_struggle"
  | "compliment"
  | "share_goal"
  | "gossip_positive"
  | "gossip_negative"
  | "check_in"
  | "apologize"
  | "thank"
  | "invite"
  | "disagree"
  | "reassure"
  | "threat";

/** One thing an agent said recently — drives anti-repetition cooldowns. */
export type SocialAct = {
  tick: number;
  intent: SocialIntent;
  targetId: string;
  lineKey: string; // intent + topic + subject; a "template family"
  line: string; // the exact rendered text
};

export type AgentSocialState = {
  /** Most recent social acts by this agent, newest last (capped). */
  recent: SocialAct[];
};

// ---------------------------------------------------------------------------
// Groups / factions
// ---------------------------------------------------------------------------

export type Group = {
  id: string;
  name: string;
  members: string[];
  leaderId?: string;
  sharedResources: Inventory;
  values: string[];
  enemies: string[];
  allies: string[];
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type WorldEventType =
  | "birth"
  | "death"
  | "attack"
  | "theft"
  | "trade"
  | "share"
  | "alliance"
  | "shelter_built"
  | "shortage"
  | "group_formed"
  | "law_proposed"
  | "law_broken"
  | "reproduction"
  | "betrayal"
  | "rescue"
  | "heal"
  | "message"
  | "reflection"
  | "chronicle"
  | "system";

export type WorldEvent = {
  id: string;
  tick: number;
  day: number;
  type: WorldEventType;
  /** Human-readable log line. */
  text: string;
  agentIds: string[];
  /** Severity hint for filtering / styling: 0 trivial .. 3 major. */
  severity: 0 | 1 | 2 | 3;
};

/** Per-agent feed of what happened to them today, fed to nightly reflection. */
export type AgentEvent = {
  tick: number;
  day: number;
  type: WorldEventType;
  text: string;
  otherAgentIds: string[];
  emotionalWeight: number;
};

/**
 * A village-wide "chronicle" of one day: a narrative woven from the agents'
 * reflections (their thoughts) plus the day's notable world events. Produced at
 * the dawn after each reflection batch and shown in the Diary tab.
 */
export type DailySummary = {
  /** The day being summarized (the day that just ended). */
  day: number;
  /** Narrative paragraph of the day's events and the villagers' moods. */
  text: string;
  /** A few short headline bullets (most salient happenings). */
  headlines: string[];
  population: number;
  births: number;
  deaths: number;
  conflicts: number;
  /** How many agents reflected into this chronicle. */
  reflectionCount: number;
  /** True if produced by the deterministic fallback (no live LLM). */
  fellBack: boolean;
};

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

export type LLMProviderName = "mock" | "ollama" | "lmstudio" | "openai" | "anthropic";

export type ReflectionMode =
  | "no_llm"
  | "individual_nightly"
  | "batch_nightly"
  | "every_n_days"
  | "major_events_only"
  | "hybrid_local_cloud";

export type LLMConfig = {
  enabled: boolean;
  provider: LLMProviderName;
  baseUrl: string;
  model: string;

  reflectionMode: ReflectionMode;
  maxAgentsPerBatch: number;
  reflectEveryNDays: number;

  useCloudForMajorEvents: boolean;
  localModel: string;
  cloudModel?: string;
  /** API key for openai/anthropic providers; stored only in memory/localStorage. */
  apiKey?: string;

  /**
   * Enable a thinking/reasoning pass for hybrid models (e.g. qwen3) on Ollama.
   * Off by default: for this short structured-reflection task a single pass is
   * faster and just as in-character, and thinking can exhaust the token budget
   * before emitting JSON. If you turn this on, raise maxTokens well above 1500.
   */
  think?: boolean;

  temperature: number;
  maxTokens: number;
  timeoutMs: number;
};

export type NightlyReflectionInput = {
  agent: {
    id: string;
    name: string;
    age: number;
    gender?: string;
    persona: string;
    traits: AgentTraits;
    skills: AgentSkills;
  };
  currentState: {
    needs: AgentNeeds;
    inventory: Inventory;
    health: number;
    locationSummary: string;
  };
  mind: AgentMind;
  relationships: Record<string, SocialOpinion>;
  /** id -> display name, so the model can talk about others by name. */
  agentNames: Record<string, string>;
  todaysEvents: AgentEvent[];
  worldSummary: WorldSummary;
};

export type WorldSummary = {
  foodScarcity: number;
  waterScarcity: number;
  dangerLevel: number;
  population: number;
  deathsToday: number;
  birthsToday: number;
  conflictsToday: number;
};

export type RelationshipUpdate = {
  agentId: string;
  trustDelta?: number;
  affectionDelta?: number;
  fearDelta?: number;
  respectDelta?: number;
  resentmentDelta?: number;
  attractionDelta?: number;
  note: string;
};

export type NightlyReflectionOutput = {
  dailyPriorities: DailyPriorities;
  relationshipUpdates: RelationshipUpdate[];
  newBeliefs: Belief[];
  updatedGoals: Goal[];
  emotionalState: EmotionalState;
  currentStrategy: string;
  privateThoughts: string[];
  reflectionSummary: string;
};

export type BatchNightlyReflectionInput = {
  agents: NightlyReflectionInput[];
};

export type BatchNightlyReflectionOutput = {
  reflections: Array<{ agentId: string; output: NightlyReflectionOutput }>;
};

export type LLMProvider = {
  name: LLMProviderName;
  generateReflection(input: NightlyReflectionInput): Promise<NightlyReflectionOutput>;
  generateBatchReflection?(
    input: BatchNightlyReflectionInput
  ): Promise<BatchNightlyReflectionOutput>;
  /**
   * Optional JSON-constrained generation, used for the village daily chronicle.
   * Returns the raw model string (a JSON object) for the caller to parse. JSON
   * mode is deliberate: it suppresses hybrid models' (qwen3) chain-of-thought,
   * which would otherwise leak into free-form prose. Providers that don't
   * implement it fall back to a deterministic narrative. Config is captured at
   * provider creation.
   */
  generateJson?(system: string, user: string): Promise<string>;
};

export type MajorEventReflectionTriggers = {
  attacked: boolean;
  stoleFrom: boolean;
  nearlyDied: boolean;
  reproduced: boolean;
  childBorn: boolean;
  friendDied: boolean;
  partnerDied: boolean;
  shelterDestroyed: boolean;
  joinedFaction: boolean;
  betrayed: boolean;
};

// ---------------------------------------------------------------------------
// Reproduction config
// ---------------------------------------------------------------------------

export type ReproductionRules = {
  requiredParticipants: number;
  requiredGenders?: string[];
  allowSameGender: boolean;
  allowAsexual: boolean;
  minimumAge: number;
  maximumAge?: number;
  requiresShelter: boolean;
  requiresFoodSurplus: boolean;
  childCreationCost: {
    food: number;
    water: number;
    energy: number;
  };
  /** Cooldown in days before an agent can reproduce again. */
  cooldownDays: number;
};

// ---------------------------------------------------------------------------
// Simulation config
// ---------------------------------------------------------------------------

export type SimulationConfig = {
  worldWidth: number;
  worldHeight: number;
  startingAgentCount: number;
  maxAgents: number;

  startingFood: number;
  startingWater: number;
  startingWood: number;
  startingStone: number;
  startingMedicine: number;

  resourceScarcity: number; // 0..1, scales how many resource tiles spawn
  resourceRegenerationRate: number; // multiplier on per-tile regen

  hungerRate: number;
  thirstRate: number;
  hygieneDecayRate: number;
  energyDecayRate: number;
  socialDecayRate: number;

  reproductionEnabled: boolean;
  reproductionRules: ReproductionRules;

  conflictEnabled: boolean;
  violenceEnabled: boolean;
  diplomacyEnabled: boolean;
  tradingEnabled: boolean;
  stealingEnabled: boolean;

  diseaseEnabled: boolean;
  weatherEnabled: boolean;
  disastersEnabled: boolean;
  /** Seasonal swings in renewable-resource regen (boom in spring/summer,
   *  famine in winter). Drives a store-for-winter survival loop. */
  seasonsEnabled: boolean;

  llm: LLMConfig;

  mutationRate: number; // 0..1
  childInheritanceStrength: number; // 0..1

  ticksPerDay: number;
};

export type WorldPresetName =
  | "Abundant Paradise"
  | "Balanced Village"
  | "Harsh Survival"
  | "Drought"
  | "Winter"
  | "Post-Collapse"
  | "Tiny Island"
  | "Overcrowded World";

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type Metrics = {
  population: number;
  births: number;
  deaths: number;
  avgHunger: number;
  avgThirst: number;
  avgTrust: number;
  violenceRate: number; // attacks per agent per day (rolling)
  resourceInequality: number; // gini-ish 0..1
  shelters: number;
  factions: number;
  cooperationScore: number; // 0..100
  collapseRisk: number; // 0..100
  utopiaScore: number; // 0..100
};

// ---------------------------------------------------------------------------
// Top-level world state container
// ---------------------------------------------------------------------------

export type WorldState = {
  config: SimulationConfig;
  tiles: Tile[][]; // [y][x]
  agents: Record<string, Agent>;
  agentOrder: string[]; // stable iteration / spawn order
  shelters: Record<string, Shelter>;
  /** Communal granaries (food stores), keyed by id. */
  foodStores: Record<string, FoodStore>;
  groups: Record<string, Group>;
  messages: Message[];
  events: WorldEvent[];
  /** Per-agent event feed for the current day, cleared each dawn. */
  dailyAgentEvents: Record<string, AgentEvent[]>;
  /** Village-wide daily chronicles, newest last (capped). */
  dailySummaries: DailySummary[];

  tick: number;
  day: number;
  /** 0..1 across a day; <0.75 = day, otherwise night. */
  timeOfDay: number;

  // running counters (reset daily where noted)
  birthsToday: number;
  deathsToday: number;
  conflictsToday: number;
  totalBirths: number;
  totalDeaths: number;
  attackEventsRolling: number[]; // attacks per recent day, for violenceRate

  rngState: number; // deterministic PRNG seed/state
};
