import type { Agent, AgentSkills, AgentTraits, Inventory, Position } from "../types";
import { defaultMind } from "./mind";
import { defaultNeeds } from "./needs";
import { defaultSkills, makeSkills } from "./skills";
import { defaultTraits, makeTraits } from "./traits";
import { hashStringToInt } from "../util/rng";

export type AgentSpec = {
  id: string;
  name: string;
  age?: number;
  gender?: string;
  persona: string;
  traits?: Partial<AgentTraits>;
  skills?: Partial<AgentSkills>;
  inventory?: Inventory;
  color?: string;
  position?: Position;
};

/** Deterministic pleasant color from an id/name so agents stay visually stable. */
export function colorForAgent(seed: string): string {
  const h = hashStringToInt(seed) % 360;
  return `hsl(${h}, 65%, 60%)`;
}

export function createAgent(spec: AgentSpec): Agent {
  return {
    id: spec.id,
    name: spec.name,
    age: spec.age ?? 22,
    gender: spec.gender,
    color: spec.color ?? colorForAgent(spec.id + spec.name),

    position: spec.position ?? { x: 0, y: 0 },

    persona: spec.persona,
    traits: spec.traits ? makeTraits(spec.traits) : defaultTraits(),
    skills: spec.skills ? makeSkills(spec.skills) : defaultSkills(),
    needs: defaultNeeds(),
    inventory: { ...(spec.inventory ?? {}) },

    relationships: {},
    memories: [],

    mind: defaultMind(spec.persona),

    health: 100,
    alive: true,

    currentGoal: undefined,
    currentAction: "idle",
    currentTargetAgentId: undefined,
    currentTargetPosition: undefined,
    path: [],

    familyIds: [],
    groupIds: [],

    lastReflectionDay: 0,
    pendingMajorEvent: false,
  };
}

export function inventoryCount(inv: Inventory, type: keyof Inventory): number {
  return inv[type] ?? 0;
}

export function addToInventory(inv: Inventory, type: keyof Inventory, amount: number): void {
  inv[type] = Math.max(0, (inv[type] ?? 0) + amount);
}

export function totalInventory(inv: Inventory): number {
  let s = 0;
  for (const k in inv) s += inv[k as keyof Inventory] ?? 0;
  return s;
}
