import type { Agent, Group, WorldState } from "../types";
import { logEvent } from "./events";
import { nextId } from "./world";

const GROUP_ADJECTIVES = ["Hearth", "River", "Stone", "Dawn", "Iron", "Free", "Quiet", "Wild"];
const GROUP_NOUNS = ["Kin", "Circle", "Pact", "Folk", "Hands", "Watch", "Collective", "Band"];

export function groupName(world: WorldState): string {
  const i = Object.keys(world.groups).length;
  const adj = GROUP_ADJECTIVES[i % GROUP_ADJECTIVES.length];
  const noun = GROUP_NOUNS[(i * 3 + 1) % GROUP_NOUNS.length];
  return `${adj} ${noun}`;
}

export function createGroup(world: WorldState, founder: Agent, values: string[] = []): Group {
  const id = nextId(world, "grp");
  const group: Group = {
    id,
    name: groupName(world),
    members: [founder.id],
    leaderId: founder.id,
    sharedResources: {},
    values: values.length ? values : ["mutual aid"],
    enemies: [],
    allies: [],
  };
  world.groups[id] = group;
  if (!founder.groupIds.includes(id)) founder.groupIds.push(id);
  logEvent(world, "group_formed", `${founder.name} founded ${group.name}.`, [founder.id], 2, {
    weight: 50,
  });
  return group;
}

export function joinGroup(world: WorldState, agent: Agent, group: Group): void {
  if (group.members.includes(agent.id)) return;
  group.members.push(agent.id);
  if (!agent.groupIds.includes(group.id)) agent.groupIds.push(group.id);
  agent.pendingMajorEvent = true;
  logEvent(world, "alliance", `${agent.name} joined ${group.name}.`, [agent.id], 1, { weight: 45 });
}

export function leaveGroup(world: WorldState, agent: Agent, group: Group): void {
  group.members = group.members.filter((m) => m !== agent.id);
  agent.groupIds = agent.groupIds.filter((g) => g !== group.id);
  if (group.leaderId === agent.id) group.leaderId = group.members[0];
  logEvent(world, "system", `${agent.name} left ${group.name}.`, [agent.id], 1);
}

export function sharedGroup(world: WorldState, a: Agent, b: Agent): Group | undefined {
  for (const gid of a.groupIds) {
    if (b.groupIds.includes(gid)) return world.groups[gid];
  }
  return undefined;
}

export function largestGroupSize(world: WorldState): number {
  let max = 0;
  for (const id in world.groups) max = Math.max(max, world.groups[id].members.length);
  return max;
}
