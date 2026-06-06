import type {
  AgentMind,
  DailyPriorities,
  EmotionalState,
  PriorityKey,
  SocialOpinion,
} from "../types";

export const PRIORITY_KEYS: PriorityKey[] = [
  "food",
  "water",
  "shelter",
  "safety",
  "hygiene",
  "rest",
  "social",
  "reproduction",
  "cooperation",
  "trade",
  "exploration",
  "building",
  "revenge",
  "leadership",
];

export function defaultPriorities(): DailyPriorities {
  return {
    food: 60,
    water: 60,
    shelter: 40,
    safety: 45,
    hygiene: 25,
    rest: 35,
    social: 35,
    reproduction: 15,
    cooperation: 40,
    trade: 20,
    exploration: 25,
    building: 30,
    revenge: 5,
    leadership: 15,
  };
}

export function defaultEmotionalState(): EmotionalState {
  return {
    happiness: 55,
    anger: 10,
    fear: 15,
    loneliness: 20,
    hope: 55,
    shame: 5,
    grief: 0,
  };
}

export function defaultSocialOpinion(): SocialOpinion {
  return {
    trust: 0,
    affection: 0,
    fear: 0,
    respect: 0,
    resentment: 0,
    attraction: 0,
    notes: [],
  };
}

export function defaultMind(persona: string): AgentMind {
  return {
    dailyPriorities: defaultPriorities(),
    socialOpinions: {},
    beliefs: [
      { statement: "Survival comes first.", confidence: 70, emotionalWeight: 40 },
    ],
    goals: [
      { description: "Stay fed and watered.", priority: 80, status: "active" },
    ],
    emotionalState: defaultEmotionalState(),
    currentStrategy: persona
      ? "Act according to my nature and keep myself alive."
      : "Survive.",
    privateThoughts: [],
    lastReflection: undefined,
  };
}

/**
 * Build a SocialOpinion view from a mechanical Relationship, so the LLM sees the
 * same numbers the rule engine uses (plus any opinion notes the mind has stored).
 */
export function syncOpinionFromRelationship(
  mind: AgentMind,
  otherId: string,
  rel: {
    trust: number;
    affection: number;
    fear: number;
    respect: number;
    resentment: number;
    attraction: number;
  }
): SocialOpinion {
  const existing = mind.socialOpinions[otherId];
  const op: SocialOpinion = {
    trust: rel.trust,
    affection: rel.affection,
    fear: rel.fear,
    respect: rel.respect,
    resentment: rel.resentment,
    attraction: rel.attraction,
    notes: existing?.notes ?? [],
  };
  mind.socialOpinions[otherId] = op;
  return op;
}
