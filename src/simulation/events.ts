import type { AgentEvent, WorldEvent, WorldEventType, WorldState } from "../types";

// Trivial chatter (greetings, ordinary trades, etc.) is bounded so memory stays
// sane, but the *narrative* — reflections, daily chronicles and notable events —
// is NEVER trimmed, so you can scroll the log from day 1 to the last day.
const MAX_CHATTER = 3000;

function isNarrative(e: WorldEvent): boolean {
  return e.type === "reflection" || e.type === "chronicle" || e.severity >= 2;
}

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

  // Trim only the oldest *trivial* events once chatter piles up; keep every
  // narrative event forever so the full story survives.
  let chatter = 0;
  for (const e of world.events) if (!isNarrative(e)) chatter++;
  if (chatter > MAX_CHATTER) {
    let toDrop = chatter - MAX_CHATTER;
    world.events = world.events.filter((e) => {
      if (toDrop > 0 && !isNarrative(e)) {
        toDrop--;
        return false;
      }
      return true;
    });
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
