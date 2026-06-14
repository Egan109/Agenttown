import { addMemory, makeMemory } from "../agents/memory";
import { getRelationship, relationshipWarmth } from "../agents/relationships";
import type { Agent, WorldState } from "../types";
import { clamp100, clampSigned } from "../util/math";
import { logEvent, pushAgentEvent } from "./events";

/**
 * The single chokepoint through which agents die. Marks the agent dead, drops
 * their body's resources back onto the world implicitly (left in inventory for
 * looting), records the death, and propagates grief to those who knew them.
 */
export function killAgent(world: WorldState, agent: Agent, cause: string, killer?: Agent): void {
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
    // A death must be visible to the survivor's nightly reflection, so push it
    // into their daily feed (the only event source the LLM prompt sees) — with a
    // high emotional weight so it dominates over the day's trades/chatter.
    let feedText: string;
    let feedWeight: number;
    if (warmth > 60) {
      // Loved them: grief.
      other.mind.emotionalState.grief = clamp100(other.mind.emotionalState.grief + 30);
      other.mind.emotionalState.happiness = clamp100(other.mind.emotionalState.happiness - 15);
      other.pendingMajorEvent = true;
      feedText = `${agent.name} died (${cause}). I cared about them.`;
      feedWeight = 100;
      addMemory(
        other,
        makeMemory(world.tick, world.day, `${agent.name} died. I will miss them.`, "death", 85, [
          agent.id,
        ])
      );
    } else if (rel.resentment > 50 || rel.fear > 50) {
      // Feared/hated them: relief, maybe grim satisfaction.
      other.mind.emotionalState.fear = clamp100(other.mind.emotionalState.fear - 12);
      other.pendingMajorEvent = true;
      feedText = `${agent.name} is dead (${cause}). They were no friend of mine.`;
      feedWeight = 80;
      addMemory(
        other,
        makeMemory(world.tick, world.day, `${agent.name} is dead. I feel safer.`, "death", 55, [
          agent.id,
        ])
      );
    } else {
      other.pendingMajorEvent = true;
      feedText = `${agent.name} died (${cause}).`;
      feedWeight = 70;
      addMemory(
        other,
        makeMemory(world.tick, world.day, `${agent.name} died.`, "death", 35, [agent.id])
      );
    }
    pushAgentEvent(world, other.id, {
      tick: world.tick,
      day: world.day,
      type: "death",
      text: feedText,
      otherAgentIds: [agent.id],
      emotionalWeight: feedWeight,
    });
  }

  // A killing turns the village against the killer — the heart of emergent feuds.
  // Those who loved the victim gain real resentment + fear (enough to clear the
  // rule engine's revenge threshold so retaliation can actually happen); those who
  // merely knew them distrust the killer; even strangers fear a known murderer.
  if (killer && killer.alive && killer.id !== agent.id) {
    for (const other of world.agentOrder.map((id) => world.agents[id])) {
      if (!other || !other.alive || other.id === killer.id || other.id === agent.id) continue;
      const victimRel = other.relationships[agent.id];
      const warmthForVictim = victimRel ? relationshipWarmth(victimRel) : 0;
      const kRel = getRelationship(other, killer.id);
      if (warmthForVictim > 60) {
        // Loved the victim: grief curdles into a grudge against the killer.
        kRel.resentment = clamp100(kRel.resentment + 45);
        kRel.fear = clamp100(kRel.fear + 25);
        kRel.trust = clampSigned(kRel.trust - 35);
        kRel.affection = clampSigned(kRel.affection - 30);
        other.mind.emotionalState.anger = clamp100(other.mind.emotionalState.anger + 25);
        other.pendingMajorEvent = true;
        addMemory(
          other,
          makeMemory(world.tick, world.day, `${killer.name} killed ${agent.name}. I want them to pay.`, "trauma", 92, [
            killer.id,
          ])
        );
      } else if (victimRel) {
        // Knew the victim: a killer is dangerous and no longer to be trusted.
        kRel.fear = clamp100(kRel.fear + 18);
        kRel.resentment = clamp100(kRel.resentment + 14);
        kRel.trust = clampSigned(kRel.trust - 14);
        other.pendingMajorEvent = true;
      } else {
        // Didn't know the victim, but word of a killing spreads fear.
        kRel.fear = clamp100(kRel.fear + 10);
        kRel.trust = clampSigned(kRel.trust - 6);
      }
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
