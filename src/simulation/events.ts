import type { AgentEvent, WorldEvent, WorldEventType, WorldState } from "../types";

const MAX_EVENTS = 600;

let eventCounter = 0;

/**
 * Record a world-level event (the global log shown in the UI) and optionally
 * fan it out into per-agent daily feeds for nightly reflection.
 */
export function logEvent(
  world: WorldState,
  type: WorldEventType,
  text: string,
  agentIds: string[],
  severity: 0 | 1 | 2 | 3 = 1,
  agentFeed?: { weight: number }
): void {
  const ev: WorldEvent = {
    id: `e${(eventCounter++).toString(36)}`,
    tick: world.tick,
    day: world.day,
    type,
    text,
    agentIds,
    severity,
  };
  world.events.push(ev);
  if (world.events.length > MAX_EVENTS) {
    world.events.splice(0, world.events.length - MAX_EVENTS);
  }

  if (agentFeed) {
    for (const id of agentIds) {
      pushAgentEvent(world, id, {
        tick: world.tick,
        day: world.day,
        type,
        text,
        otherAgentIds: agentIds.filter((a) => a !== id),
        emotionalWeight: agentFeed.weight,
      });
    }
  }
}

export function pushAgentEvent(world: WorldState, agentId: string, ev: AgentEvent): void {
  if (!world.dailyAgentEvents[agentId]) world.dailyAgentEvents[agentId] = [];
  world.dailyAgentEvents[agentId].push(ev);
}

export function clearDailyAgentEvents(world: WorldState): void {
  world.dailyAgentEvents = {};
}

export function recentEvents(world: WorldState, n: number): WorldEvent[] {
  return world.events.slice(Math.max(0, world.events.length - n));
}
