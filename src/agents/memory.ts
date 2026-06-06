import type { Agent, Memory, MemoryType } from "../types";

const MAX_MEMORIES = 40;

export function makeMemory(
  tick: number,
  day: number,
  description: string,
  type: MemoryType,
  emotionalWeight: number,
  relatedAgentIds: string[] = []
): Memory {
  return { tick, day, description, type, emotionalWeight, relatedAgentIds };
}

/**
 * Add a memory, keeping only the most salient ones. When over capacity we drop
 * the lowest-weight, oldest memory — so a trauma sticks around far longer than
 * a routine "gathered some wood".
 */
export function addMemory(agent: Agent, memory: Memory): void {
  agent.memories.push(memory);
  if (agent.memories.length > MAX_MEMORIES) {
    let worstIdx = 0;
    let worstScore = Infinity;
    for (let i = 0; i < agent.memories.length; i++) {
      const m = agent.memories[i];
      // Salience = emotional weight, lightly boosted for recency.
      const score = m.emotionalWeight + (m.day - memory.day) * 0.5;
      if (score < worstScore) {
        worstScore = score;
        worstIdx = i;
      }
    }
    agent.memories.splice(worstIdx, 1);
  }
}

/** Memories involving a particular agent, strongest first. */
export function memoriesAbout(agent: Agent, otherId: string): Memory[] {
  return agent.memories
    .filter((m) => m.relatedAgentIds.includes(otherId))
    .sort((a, b) => b.emotionalWeight - a.emotionalWeight);
}

/** The N most emotionally significant memories, for reflection prompts. */
export function topMemories(agent: Agent, n: number): Memory[] {
  return [...agent.memories]
    .sort((a, b) => b.emotionalWeight - a.emotionalWeight)
    .slice(0, n);
}
