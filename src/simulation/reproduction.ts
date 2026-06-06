import { addToInventory, createAgent, inventoryCount } from "../agents/Agent";
import { colorForAgent } from "../agents/Agent";
import { addMemory, makeMemory } from "../agents/memory";
import { applyInteraction, getRelationship } from "../agents/relationships";
import { inheritSkills } from "../agents/skills";
import { inheritTraits } from "../agents/traits";
import type { Agent, AgentTraits, Position, WorldState } from "../types";
import type { Rng } from "../util/rng";
import { logEvent } from "./events";
import { getTile, nextId } from "./world";

const CHILD_NAMES = [
  "Rilo", "Wren", "Sol", "Pax", "Nima", "Eda", "Tov", "Cael", "Isa", "Bram",
  "Lyra", "Finn", "Oda", "Vex", "Kai", "Mira", "Tane", "Ovo", "Sena", "Dax",
];

/** Whether `a` is individually eligible (age window, drive, health, cooldown). */
export function eligibleToReproduce(world: WorldState, a: Agent): boolean {
  const rules = world.config.reproductionRules;
  if (!world.config.reproductionEnabled) return false;
  if (a.age < rules.minimumAge) return false;
  if (rules.maximumAge != null && a.age > rules.maximumAge) return false;
  if (a.health < 40) return false;
  if (a.needs.reproduction < 55) return false;
  if (a.needs.hunger > 80 || a.needs.thirst > 80) return false;
  // Cooldown tracked via a private thought timestamp is overkill; use memory.
  const recent = a.memories.find(
    (m) => m.type === "birth" && world.day - m.day < rules.cooldownDays
  );
  if (recent) return false;
  return true;
}

/** Whether a candidate pair (or solo, if asexual) may produce a child. */
export function pairCanReproduce(world: WorldState, a: Agent, b?: Agent): boolean {
  const rules = world.config.reproductionRules;
  if (world.agentOrder.filter((id) => world.agents[id].alive).length >= world.config.maxAgents)
    return false;

  if (rules.allowAsexual && rules.requiredParticipants <= 1 && !b) {
    return eligibleToReproduce(world, a);
  }
  if (!b) return false;
  if (!eligibleToReproduce(world, a) || !eligibleToReproduce(world, b)) return false;

  if (!rules.allowSameGender && a.gender && b.gender && a.gender === b.gender) return false;
  if (rules.requiredGenders && rules.requiredGenders.length > 0) {
    const have = new Set([a.gender, b.gender]);
    for (const g of rules.requiredGenders) if (!have.has(g)) return false;
  }

  // Mutual willingness: enough affection/attraction between them.
  const relAB = getRelationship(a, b.id);
  const relBA = getRelationship(b, a.id);
  const mutual =
    relAB.affection + relAB.attraction > 30 && relBA.affection + relBA.attraction > 30;
  if (!mutual) return false;

  if (rules.requiresShelter) {
    const sheltered = isSheltered(world, a) && isSheltered(world, b);
    if (!sheltered) return false;
  }
  if (rules.requiresFoodSurplus) {
    const surplus = inventoryCount(a.inventory, "food") + inventoryCount(b.inventory, "food");
    if (surplus < rules.childCreationCost.food) return false;
  }
  return true;
}

function isSheltered(world: WorldState, a: Agent): boolean {
  const t = getTile(world, a.position.x, a.position.y);
  return !!t?.shelterId;
}

function freeAdjacent(world: WorldState, pos: Position): Position {
  const deltas = [
    [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  for (const [dx, dy] of deltas) {
    const t = getTile(world, pos.x + dx, pos.y + dy);
    if (t && t.walkable && t.terrain !== "danger") return { x: t.x, y: t.y };
  }
  return { ...pos };
}

/**
 * Create a child from one or two parents, paying the resource/energy cost and
 * wiring family relationships. Returns the new agent (already inserted).
 */
export function reproduce(world: WorldState, parents: Agent[], rng: Rng): Agent {
  const rules = world.config.reproductionRules;
  const cost = rules.childCreationCost;

  // Pay food/water cost split across parents; pay energy individually.
  payShared(parents, "food", cost.food);
  payShared(parents, "water", cost.water);
  for (const p of parents) {
    p.needs.energy = Math.min(100, p.needs.energy + cost.energy);
    p.needs.reproduction = 0;
  }

  const parentTraits: AgentTraits[] = parents.map((p) => p.traits);
  const traits = inheritTraits(
    parentTraits,
    rng,
    world.config.childInheritanceStrength,
    world.config.mutationRate
  );
  const skills = inheritSkills(
    parents.map((p) => p.skills),
    rng,
    world.config.childInheritanceStrength
  );

  const id = nextId(world, "child");
  const name = rng.pick(CHILD_NAMES) + (world.totalBirths > 0 ? `-${world.totalBirths}` : "");
  const parentList = parents.map((p) => p.name).join(" & ");
  const child = createAgent({
    id,
    name,
    age: 0,
    gender: rng.pick(["male", "female", "nonbinary"]),
    persona: `${name}, a child of ${parentList}. Their character is still forming.`,
    color: colorForAgent(id + name),
  });
  // Inject inherited traits/skills (createAgent used defaults).
  child.traits = traits;
  child.skills = skills;
  child.position = freeAdjacent(world, parents[0].position);
  child.familyIds = parents.map((p) => p.id);

  // Inherit some group culture from parents.
  const groupIds = new Set<string>();
  for (const p of parents) for (const g of p.groupIds) groupIds.add(g);
  child.groupIds = [...groupIds];
  for (const gid of child.groupIds) {
    const g = world.groups[gid];
    if (g && !g.members.includes(child.id)) g.members.push(child.id);
  }

  // Inherit a relationship seed: children love their parents, parents love child.
  for (const p of parents) {
    const cp = getRelationship(child, p.id);
    cp.affection = 60;
    cp.trust = 50;
    const pc = getRelationship(p, child.id);
    pc.affection = 70;
    pc.trust = 60;
    p.familyIds = [...new Set([...p.familyIds, child.id])];
    p.pendingMajorEvent = true;
    addMemory(
      p,
      makeMemory(world.tick, world.day, `My child ${name} was born.`, "birth", 90, [
        child.id,
        ...parents.filter((q) => q !== p).map((q) => q.id),
      ])
    );
  }
  // Co-parents bond.
  if (parents.length === 2) {
    applyInteraction(parents[0], parents[1].id, "reproduce");
    applyInteraction(parents[1], parents[0].id, "reproduce");
  }

  world.agents[id] = child;
  world.agentOrder.push(id);
  world.birthsToday++;
  world.totalBirths++;

  logEvent(
    world,
    "birth",
    `A child named ${name} was born to ${parentList}.`,
    [child.id, ...parents.map((p) => p.id)],
    3,
    { weight: 90 }
  );
  logEvent(world, "reproduction", `${parentList} produced a child.`, parents.map((p) => p.id), 2);

  return child;
}

function payShared(parents: Agent[], type: "food" | "water", total: number): void {
  let remaining = total;
  for (const p of parents) {
    if (remaining <= 0) break;
    const have = inventoryCount(p.inventory, type);
    const pay = Math.min(have, Math.ceil(total / parents.length), remaining);
    addToInventory(p.inventory, type, -pay);
    remaining -= pay;
  }
  // If still owed (rule wasn't strictly enforced), take whatever is left.
  for (const p of parents) {
    if (remaining <= 0) break;
    const have = inventoryCount(p.inventory, type);
    const pay = Math.min(have, remaining);
    addToInventory(p.inventory, type, -pay);
    remaining -= pay;
  }
}
