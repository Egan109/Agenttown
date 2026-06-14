import type { Agent, Relationship } from "../types";
import { clamp100, clampSigned } from "../util/math";

export function defaultRelationship(): Relationship {
  return { trust: 0, affection: 0, fear: 0, respect: 0, resentment: 0, attraction: 0, familiarity: 0 };
}

export function getRelationship(agent: Agent, otherId: string): Relationship {
  let rel = agent.relationships[otherId];
  if (!rel) {
    rel = defaultRelationship();
    agent.relationships[otherId] = rel;
  }
  return rel;
}

export type RelationshipDelta = Partial<Relationship>;

export function applyRelationshipDelta(rel: Relationship, delta: RelationshipDelta): void {
  if (delta.trust != null) rel.trust = clampSigned(rel.trust + delta.trust);
  if (delta.affection != null) rel.affection = clampSigned(rel.affection + delta.affection);
  if (delta.fear != null) rel.fear = clamp100(rel.fear + delta.fear);
  if (delta.respect != null) rel.respect = clamp100(rel.respect + delta.respect);
  if (delta.resentment != null) rel.resentment = clamp100(rel.resentment + delta.resentment);
  if (delta.attraction != null) rel.attraction = clamp100(rel.attraction + delta.attraction);
  if (delta.familiarity != null) rel.familiarity = clamp100(rel.familiarity + delta.familiarity);
}

/**
 * Canonical relationship consequences for social actions (from the design spec).
 * The rule engine calls applyInteraction whenever one agent acts on another.
 */
export const INTERACTION_EFFECTS = {
  share: { trust: 10, affection: 5 } as RelationshipDelta,
  successful_trade: { trust: 5, respect: 5 } as RelationshipDelta,
  steal: { trust: -25, resentment: 20, affection: -10 } as RelationshipDelta,
  attack: { trust: -50, fear: 30, resentment: 40, affection: -25 } as RelationshipDelta,
  heal: { trust: 20, affection: 10, respect: 5 } as RelationshipDelta,
  betrayal: { trust: -40, resentment: 40, affection: -20 } as RelationshipDelta,
  save_life: { trust: 50, affection: 30, respect: 20 } as RelationshipDelta,
  greeting: { affection: 1, trust: 1 } as RelationshipDelta,
  threat: { fear: 15, resentment: 10, trust: -10 } as RelationshipDelta,
  apology: { resentment: -12, trust: 4 } as RelationshipDelta,
  reproduce: { affection: 20, trust: 10, attraction: 10 } as RelationshipDelta,
} as const;

export type InteractionKind = keyof typeof INTERACTION_EFFECTS;

/** Apply a named interaction's effect from `actor`'s perspective toward `other`. */
export function applyInteraction(
  actor: Agent,
  otherId: string,
  kind: InteractionKind
): void {
  const rel = getRelationship(actor, otherId);
  applyRelationshipDelta(rel, INTERACTION_EFFECTS[kind]);
}

/** A single 0..100 "how much do I like/feel safe with X" heuristic. */
export function relationshipWarmth(rel: Relationship): number {
  return clamp100(50 + rel.trust * 0.3 + rel.affection * 0.3 - rel.resentment * 0.3 - rel.fear * 0.2);
}

/** A 0..100 "how threatening is X to me" heuristic. */
export function relationshipThreat(rel: Relationship): number {
  return clamp100(rel.fear * 0.5 + rel.resentment * 0.3 - rel.trust * 0.2);
}
