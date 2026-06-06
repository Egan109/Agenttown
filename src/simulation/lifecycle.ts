import { addMemory, makeMemory } from "../agents/memory";
import { getRelationship, relationshipWarmth } from "../agents/relationships";
import type { Agent, WorldState } from "../types";
import { clamp100 } from "../util/math";
import { logEvent } from "./events";

/**
 * The single chokepoint through which agents die. Marks the agent dead, drops
 * their body's resources back onto the world implicitly (left in inventory for
 * looting), records the death, and propagates grief to those who knew them.
 */
export function killAgent(world: WorldState, agent: Agent, cause: string): void {
  if (!agent.alive) return;
  agent.alive = false;
  agent.health = 0;
  agent.causeOfDeath = cause;
  agent.deathDay = world.day;
  agent.currentAction = "idle";
  agent.path = [];

  world.deathsToday++;
  world.totalDeaths++;

  logEvent(world, "death", `${agent.name} died (${cause}).`, [agent.id], 3, { weight: 100 });

  // Grief & relief ripple out to everyone who had an opinion of the deceased.
  for (const other of world.agentOrder.map((id) => world.agents[id])) {
    if (!other || !other.alive || other.id === agent.id) continue;
    const rel = other.relationships[agent.id];
    if (!rel) continue;
    const warmth = relationshipWarmth(rel);
    if (warmth > 60) {
      // Loved them: grief.
      other.mind.emotionalState.grief = clamp100(other.mind.emotionalState.grief + 30);
      other.mind.emotionalState.happiness = clamp100(other.mind.emotionalState.happiness - 15);
      other.pendingMajorEvent = true;
      addMemory(
        other,
        makeMemory(world.tick, world.day, `${agent.name} died. I will miss them.`, "death", 85, [
          agent.id,
        ])
      );
    } else if (rel.resentment > 50 || rel.fear > 50) {
      // Feared/hated them: relief, maybe grim satisfaction.
      other.mind.emotionalState.fear = clamp100(other.mind.emotionalState.fear - 12);
      addMemory(
        other,
        makeMemory(world.tick, world.day, `${agent.name} is dead. I feel safer.`, "death", 55, [
          agent.id,
        ])
      );
    } else {
      addMemory(
        other,
        makeMemory(world.tick, world.day, `${agent.name} died.`, "death", 35, [agent.id])
      );
    }
  }

  // Remove from any groups they led/belonged to.
  for (const gid of agent.groupIds) {
    const g = world.groups[gid];
    if (!g) continue;
    g.members = g.members.filter((m) => m !== agent.id);
    if (g.leaderId === agent.id) g.leaderId = g.members[0];
  }

  // Vacate shelters.
  for (const sid in world.shelters) {
    const s = world.shelters[sid];
    s.occupantIds = s.occupantIds.filter((o) => o !== agent.id);
  }
}

/** Mark a relationship-aware betrayal (used when an ally steals/attacks kin). */
export function noteBetrayal(world: WorldState, victim: Agent, betrayer: Agent): void {
  const rel = getRelationship(victim, betrayer.id);
  rel.trust = Math.max(-100, rel.trust - 40);
  rel.resentment = clamp100(rel.resentment + 40);
  victim.pendingMajorEvent = true;
  addMemory(
    victim,
    makeMemory(world.tick, world.day, `${betrayer.name} betrayed me.`, "betrayal", 80, [betrayer.id])
  );
  logEvent(world, "betrayal", `${betrayer.name} betrayed ${victim.name}.`, [betrayer.id, victim.id], 3, {
    weight: 85,
  });
}
