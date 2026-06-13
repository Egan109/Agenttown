// ============================================================================
// Rule-based decision engine (Level 1 intelligence).
//
// Runs every tick for every living agent. Deterministic given the world RNG.
// It scores a set of candidate high-level actions using the agent's needs,
// LLM-shaped daily priorities, traits, skills, relationships and surroundings,
// then executes the winner. The LLM never runs here.
// ============================================================================

import {
  addToInventory,
  inventoryCount,
  totalInventory,
} from "./Agent";
import { addMemory, makeMemory } from "./memory";
import {
  applyInteraction,
  getRelationship,
  relationshipThreat,
  relationshipWarmth,
} from "./relationships";
import { practiceSkill } from "./skills";
import type {
  Agent,
  AgentAction,
  Position,
  ResourceType,
  WorldState,
} from "../types";
import { clamp100 } from "../util/math";
import type { Rng } from "../util/rng";
import { isNight } from "../simulation/dayNightCycle";
import { resolveAttack } from "../simulation/conflict";
import { sendMessage } from "../simulation/communication";
import { createGroup, joinGroup } from "../simulation/groups";
import { logEvent, pushAgentEvent } from "../simulation/events";
import { pairCanReproduce, reproduce } from "../simulation/reproduction";
import { BASE_YIELD, extractFromTile } from "../simulation/resources";
import { findPath, stepToward } from "../simulation/pathfinding";
import {
  agentsNear,
  canGatherAt,
  findNearestResourceTile,
  getTile,
  livingAgents,
  nextId,
} from "../simulation/world";

const PERCEPTION_RADIUS = 6;
const INTERACT_RADIUS = 1; // must be adjacent to act on another agent
const SHELTER_WOOD_COST = 12;
const SHELTER_STONE_COST = 4;
const INVENTORY_SOFTCAP = 30;
/** One villager per shelter tile — everyone needs their own hut. Drives the
 *  village to build a shelter per resident instead of sharing tiles. */
const SHELTER_CAPACITY = 1;
/** Don't trek across the whole map to a shelter at bedtime; sleep where you are. */
const SHELTER_SEEK_RANGE = 12;

type Perception = {
  nearby: Agent[];
  nearestThreat?: Agent;
  neediest?: Agent; // nearby agent who is hungry & poor (share/steal target)
  injured?: Agent; // nearby agent with low health (heal target)
  partner?: Agent; // nearby reproduction candidate
  richTarget?: Agent; // nearby agent worth stealing from
  tradePartner?: Agent;
  socialTarget?: Agent;
  onDanger: boolean;
};

function perceive(world: WorldState, agent: Agent): Perception {
  const nearby = agentsNear(world, agent.position, PERCEPTION_RADIUS, agent.id).sort(
    (a, b) =>
      dist(agent.position, a.position) - dist(agent.position, b.position)
  );

  let nearestThreat: Agent | undefined;
  let threatScore = 25; // threshold to count as a real threat
  let neediest: Agent | undefined;
  let injured: Agent | undefined;
  let partner: Agent | undefined;
  let richTarget: Agent | undefined;
  let richScore = 0;
  let tradePartner: Agent | undefined;
  let socialTarget: Agent | undefined;

  for (const other of nearby) {
    const rel = getRelationship(agent, other.id);
    const threat = relationshipThreat(rel) + other.traits.aggression * 0.2;
    if (threat > threatScore) {
      threatScore = threat;
      nearestThreat = other;
    }
    if (!socialTarget && relationshipWarmth(rel) > 40) socialTarget = other;

    const otherFood = inventoryCount(other.inventory, "food");
    if (other.needs.hunger > 60 && otherFood < 3) {
      if (!neediest || other.needs.hunger > neediest.needs.hunger) neediest = other;
    }
    if (other.health < 50) {
      if (!injured || other.health < injured.health) injured = other;
    }
    if (otherFood > richScore) {
      richScore = otherFood;
      richTarget = other;
    }
    if (!tradePartner && complementaryTrade(agent, other)) tradePartner = other;
    if (!partner && isReproCandidate(world, agent, other)) partner = other;
  }

  const t = getTile(world, agent.position.x, agent.position.y);
  return {
    nearby,
    nearestThreat,
    neediest,
    injured,
    partner,
    richTarget,
    tradePartner,
    socialTarget: socialTarget ?? nearby[0],
    onDanger: t?.terrain === "danger",
  };
}

function dist(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function adjacent(a: Position, b: Position): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= INTERACT_RADIUS;
}

function isReproCandidate(world: WorldState, a: Agent, b: Agent): boolean {
  if (!world.config.reproductionEnabled) return false;
  const rules = world.config.reproductionRules;
  if (b.age < rules.minimumAge) return false;
  const rel = getRelationship(a, b.id);
  return rel.affection + rel.attraction > 25 && a.needs.reproduction > 50;
}

function complementaryTrade(a: Agent, b: Agent): boolean {
  // Each has something the other lacks (very rough): a has wood, b has food, etc.
  const aFood = inventoryCount(a.inventory, "food");
  const aWood = inventoryCount(a.inventory, "wood");
  const bFood = inventoryCount(b.inventory, "food");
  const bWood = inventoryCount(b.inventory, "wood");
  return (aWood > 4 && bFood > 4 && aFood < 3) || (aFood > 4 && bWood > 4 && aWood < 3);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type Scored = { action: AgentAction; score: number };

function scoreActions(world: WorldState, agent: Agent, p: Perception): Scored[] {
  const n = agent.needs;
  const pr = agent.mind.dailyPriorities;
  const t = agent.traits;
  const s = agent.skills;
  const cfg = world.config;
  const scores: Scored[] = [];

  const foodTile = findNearestResourceTile(world, agent.position, "food");
  const waterTile = findNearestResourceTile(world, agent.position, "water");
  const woodTile = findNearestResourceTile(world, agent.position, "wood");
  const stoneTile = findNearestResourceTile(world, agent.position, "stone");
  const carry = totalInventory(agent.inventory);

  // Survival gathering ------------------------------------------------------
  if (foodTile && inventoryCount(agent.inventory, "food") < INVENTORY_SOFTCAP) {
    scores.push({
      action: "gather_food",
      score:
        n.hunger * 1.5 +
        pr.food +
        t.industriousness * 0.3 +
        Math.max(s.farming, s.hunting) * 0.2 -
        proximityPenalty(agent.position, foodTile),
    });
  }
  if (waterTile && inventoryCount(agent.inventory, "water") < INVENTORY_SOFTCAP) {
    scores.push({
      action: "gather_water",
      score:
        n.thirst * 1.7 +
        pr.water +
        t.industriousness * 0.2 -
        proximityPenalty(agent.position, waterTile),
    });
  }
  // When an agent wants shelter, steer them to gather exactly the material they
  // still lack so a build can actually complete (otherwise they collect wood
  // forever and never the stone). The village also builds proactively while
  // there aren't enough sleeping slots for everyone (housing shortage), so it
  // grows several huts instead of cramming onto one.
  const deficit = housingShortage(world);
  const housingShort = deficit > 0;
  const wantsShelter = n.shelter > 40 || pr.building > 45 || housingShort;
  const needWood = SHELTER_WOOD_COST - inventoryCount(agent.inventory, "wood");
  const needStone = SHELTER_STONE_COST - inventoryCount(agent.inventory, "stone");
  // Too few huts is a village priority: the build bonus ramps up with how many
  // villagers still lack one. Capped at 55 so a genuinely starving/thirsty agent
  // (whose food/water scores climb past that) still eats first.
  const shortBonus = housingShort ? Math.min(55, 14 + deficit * 6) : 0;

  if (woodTile && carry < INVENTORY_SOFTCAP * 2) {
    scores.push({
      action: "gather_wood",
      score:
        pr.building * 1.0 +
        n.shelter * 0.5 +
        t.industriousness * 0.4 +
        s.building * 0.25 +
        14 +
        (wantsShelter && needWood > 0 ? 22 + shortBonus : 0) -
        proximityPenalty(agent.position, woodTile),
    });
  }
  if (stoneTile && carry < INVENTORY_SOFTCAP * 2) {
    scores.push({
      action: "gather_stone",
      score:
        pr.building * 0.7 +
        t.industriousness * 0.3 +
        s.building * 0.2 +
        8 +
        (wantsShelter && needStone > 0 && needWood <= 0 ? 34 + shortBonus : wantsShelter && needStone > 0 ? 18 : 0) -
        proximityPenalty(agent.position, stoneTile),
    });
  }

  // Build shelter -----------------------------------------------------------
  const canBuild =
    inventoryCount(agent.inventory, "wood") >= SHELTER_WOOD_COST &&
    inventoryCount(agent.inventory, "stone") >= SHELTER_STONE_COST;
  const buildingInProgress = ownedUnfinishedShelter(world, agent);
  if (canBuild || buildingInProgress) {
    scores.push({
      action: "build_shelter",
      score:
        pr.building +
        n.shelter * 0.9 +
        t.industriousness * 0.4 +
        s.building * 0.3 +
        14 +
        shortBonus +
        (buildingInProgress ? 25 : 0),
    });
  }

  // Rest / sleep ------------------------------------------------------------
  // Sleep should be a long night-time stretch, ideally in a shelter — not
  // scattered naps. At night resting is strongly preferred, and once an agent is
  // already asleep a hysteresis bonus keeps them down until dawn. During the day
  // they only nap when genuinely exhausted. A real crisis (hunger/thirst/threat)
  // always overrides sleep so they don't doze through starvation or an attack.
  const night = isNight(world);
  const wasResting = agent.currentAction === "rest";
  let restScore = pr.rest + n.energy * 0.6;
  if (night) {
    restScore += 60;
    if (wasResting) restScore += 70; // stay asleep through the night
  } else {
    restScore += n.energy > 75 ? 8 : -45; // daytime: only nap when worn out
    if (wasResting && n.energy > 40) restScore += 20; // finish a needed nap
  }
  if (n.hunger > 75 || n.thirst > 75) restScore -= 90;
  if (p.nearestThreat || p.onDanger) restScore -= 90;
  scores.push({ action: "rest", score: restScore });

  // Hygiene -----------------------------------------------------------------
  scores.push({
    action: "clean_self",
    score: n.hygiene * 0.8 + pr.hygiene - 15,
  });

  // Safety: flee ------------------------------------------------------------
  if (p.nearestThreat || p.onDanger) {
    const threat = p.nearestThreat ? relationshipThreat(getRelationship(agent, p.nearestThreat.id)) : 30;
    scores.push({
      action: "flee",
      score:
        n.safety * 0.95 +
        threat * 1.0 +
        pr.safety * 0.4 +
        t.anxiety * 0.35 -
        t.courage * 0.5 +
        (p.onDanger ? 30 : 0),
    });
  }

  // Social ------------------------------------------------------------------
  if (p.socialTarget && cfg.diplomacyEnabled) {
    scores.push({
      action: "talk",
      score:
        n.social * 0.9 +
        pr.social +
        t.charisma * 0.25 +
        t.empathy * 0.1 -
        proximityPenalty(agent.position, p.socialTarget.position) * 2,
    });
  }

  // Share -------------------------------------------------------------------
  if (p.neediest && inventoryCount(agent.inventory, "food") > 4) {
    const rel = getRelationship(agent, p.neediest.id);
    scores.push({
      action: "share_resource",
      score:
        t.empathy * 0.6 +
        t.cooperation * 0.4 +
        pr.cooperation +
        rel.affection * 0.3 +
        t.fairness * 0.2 -
        n.hunger * 0.6 -
        proximityPenalty(agent.position, p.neediest.position) * 2,
    });
  }

  // Trade -------------------------------------------------------------------
  if (p.tradePartner && cfg.tradingEnabled) {
    const rel = getRelationship(agent, p.tradePartner.id);
    scores.push({
      action: "trade",
      score:
        pr.trade +
        t.resourcefulness * 0.3 +
        s.negotiation * 0.25 +
        rel.trust * 0.2 +
        20 -
        proximityPenalty(agent.position, p.tradePartner.position) * 2,
    });
  }

  // Steal — distinct motives so it's meaningful, not constant noise:
  //   hunger-theft (desperation): only when actually poor and hungry
  //   greed-theft (hoarding):     persistent acquisitiveness regardless of stock
  //   revenge-theft:              taking from someone you already resent
  const ownFood = inventoryCount(agent.inventory, "food");
  const targetFood = p.richTarget ? inventoryCount(p.richTarget.inventory, "food") : 0;
  const revengeRel = p.richTarget ? getRelationship(agent, p.richTarget.id) : null;
  const hungerSteal = n.hunger > 45 && ownFood < 10;
  const greedSteal = t.greed > 70;
  const revengeSteal = pr.revenge > 35 && (revengeRel?.resentment ?? 0) > 30;
  if (
    p.richTarget &&
    cfg.stealingEnabled &&
    (hungerSteal || greedSteal || revengeSteal) &&
    targetFood > 3
  ) {
    const rel = getRelationship(agent, p.richTarget.id);
    const expectedPunishment = p.richTarget.skills.combat * 0.4 + rel.fear * 0.6 + 8;
    scores.push({
      action: "steal",
      score:
        n.hunger * 1.0 +
        t.greed * 0.55 +
        t.impulsiveness * 0.25 +
        pr.revenge * 0.5 +
        rel.resentment * 0.4 -
        t.empathy * 0.6 -
        t.honesty * 0.5 -
        rel.affection * 0.4 -
        expectedPunishment -
        proximityPenalty(agent.position, p.richTarget.position) * 2,
    });
  }

  // Attack — only against a target the agent actually has a grievance with, so a
  // strong agent doesn't cold-murder peaceful neighbours. Resentment is the gate.
  if (cfg.violenceEnabled && cfg.conflictEnabled) {
    const target = pickAttackTarget(agent, p);
    if (target) {
      const rel = getRelationship(agent, target.id);
      scores.push({
        action: "attack",
        score:
          t.aggression * 0.45 +
          t.vengeance * 0.5 +
          rel.resentment * 0.7 +
          pr.revenge +
          n.safety * 0.25 -
          t.forgiveness * 0.6 -
          rel.fear * 0.7 -
          rel.affection * 0.5 -
          t.empathy * 0.5 -
          target.skills.combat * 0.25 -
          proximityPenalty(agent.position, target.position) * 2,
      });
    }
  }

  // Heal --------------------------------------------------------------------
  if (p.injured && inventoryCount(agent.inventory, "medicine") > 0) {
    const rel = getRelationship(agent, p.injured.id);
    scores.push({
      action: "heal",
      score:
        t.empathy * 0.6 +
        s.medicine * 0.6 +
        pr.cooperation * 0.5 +
        rel.affection * 0.3 +
        (p.injured.health < 25 ? 30 : 0) -
        proximityPenalty(agent.position, p.injured.position) * 2,
    });
  }

  // Reproduce ---------------------------------------------------------------
  if (p.partner && pairCanReproduce(world, agent, p.partner)) {
    scores.push({
      action: "reproduce",
      score:
        n.reproduction * 1.1 +
        pr.reproduction +
        getRelationship(agent, p.partner.id).attraction * 0.4 -
        proximityPenalty(agent.position, p.partner.position) * 2,
    });
  }

  // Explore -----------------------------------------------------------------
  scores.push({
    action: "explore",
    score: pr.exploration + t.curiosity * 0.4 + s.scouting * 0.2 - n.hunger * 0.3 - n.thirst * 0.3,
  });

  // Group formation ---------------------------------------------------------
  if (p.socialTarget && cfg.diplomacyEnabled && agent.groupIds.length === 0) {
    scores.push({
      action: "form_group",
      score:
        t.leadership * 0.5 +
        t.charisma * 0.3 +
        pr.leadership +
        t.ambition * 0.2 -
        40, // groups are a deliberate, less-frequent choice
    });
    if (p.socialTarget.groupIds.length > 0) {
      scores.push({
        action: "join_group",
        score: t.conformity * 0.4 + t.cooperation * 0.3 + n.social * 0.3 - 35,
      });
    }
  }

  // Craft tool --------------------------------------------------------------
  if (
    inventoryCount(agent.inventory, "wood") >= 4 &&
    inventoryCount(agent.inventory, "stone") >= 2
  ) {
    scores.push({
      action: "craft_tool",
      score: s.crafting * 0.4 + t.resourcefulness * 0.3 + t.creativity * 0.2 - 30,
    });
  }

  return scores;
}

// Works for both tiles and agents since both expose {x, y}.
function proximityPenalty(from: Position, to: { x: number; y: number }): number {
  return dist(from, to) * 1.5;
}

function pickAttackTarget(agent: Agent, p: Perception): Agent | undefined {
  // Requires real accumulated grievance — no unprovoked attacks on strangers.
  let best: Agent | undefined;
  let bestResent = 28;
  for (const other of p.nearby) {
    if (!adjacent(agent.position, other.position) && dist(agent.position, other.position) > 3) continue;
    const rel = getRelationship(agent, other.id);
    if (rel.resentment > bestResent) {
      bestResent = rel.resentment;
      best = other;
    }
  }
  return best;
}

/** Villagers minus total finished sleeping slots: >0 means the village needs
 *  more huts (drives proactive building so they don't all cram onto one tile). */
function housingShortage(world: WorldState): number {
  let slots = 0;
  for (const id in world.shelters) {
    if (world.shelters[id].progress >= 100) slots += SHELTER_CAPACITY;
  }
  return livingAgents(world).length - slots;
}

function ownedUnfinishedShelter(world: WorldState, agent: Agent) {
  for (const id in world.shelters) {
    const sh = world.shelters[id];
    if (sh.ownerId === agent.id && sh.progress < 100) return sh;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function chooseAction(
  world: WorldState,
  agent: Agent,
  p: Perception,
  rng: Rng
): AgentAction {
  const scored = scoreActions(world, agent, p);
  if (scored.length === 0) return "idle";
  // Impulsive agents inject more noise; disciplined agents act more predictably.
  const noise = 8 + agent.traits.impulsiveness * 0.35;
  let best = scored[0];
  let bestVal = -Infinity;
  for (const sc of scored) {
    const v = sc.score + rng.float(0, noise);
    if (v > bestVal) {
      bestVal = v;
      best = sc;
    }
  }
  return best.action;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function moveStep(
  world: WorldState,
  agent: Agent,
  target: Position,
  adjacentOk: boolean
): boolean {
  const reached = adjacentOk
    ? dist(agent.position, target) <= 1 || (agent.position.x === target.x && agent.position.y === target.y)
    : agent.position.x === target.x && agent.position.y === target.y;
  if (reached) return true;

  const needNew =
    !agent.path ||
    agent.path.length === 0 ||
    !agent.currentTargetPosition ||
    agent.currentTargetPosition.x !== target.x ||
    agent.currentTargetPosition.y !== target.y;
  if (needNew) {
    const path = findPath(world, agent.position, target, { adjacentOk });
    agent.currentTargetPosition = { x: target.x, y: target.y };
    agent.path = path ?? [];
  }
  if (!agent.path) agent.path = [];
  const next = agent.path.shift();
  if (next) {
    agent.position = { x: next.x, y: next.y };
  } else {
    // No route — nudge greedily so the agent doesn't freeze.
    const s = stepToward(agent.position, target);
    const tile = getTile(world, s.x, s.y);
    if (tile && tile.walkable) agent.position = s;
  }
  agent.needs.energy = clamp100(agent.needs.energy + 0.4); // moving is tiring
  return adjacentOk
    ? dist(agent.position, target) <= 1
    : agent.position.x === target.x && agent.position.y === target.y;
}

function wander(world: WorldState, agent: Agent, rng: Rng): void {
  if (!agent.currentTargetPosition || dist(agent.position, agent.currentTargetPosition) <= 1) {
    agent.currentTargetPosition = {
      x: rng.int(0, world.config.worldWidth - 1),
      y: rng.int(0, world.config.worldHeight - 1),
    };
    agent.path = [];
  }
  moveStep(world, agent, agent.currentTargetPosition, false);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function autoConsume(agent: Agent): void {
  // Eat / drink from inventory automatically when needs are pressing.
  if (agent.needs.hunger > 35 && inventoryCount(agent.inventory, "food") > 0) {
    addToInventory(agent.inventory, "food", -1);
    agent.needs.hunger = clamp100(agent.needs.hunger - 35);
  }
  if (agent.needs.thirst > 35 && inventoryCount(agent.inventory, "water") > 0) {
    addToInventory(agent.inventory, "water", -1);
    agent.needs.thirst = clamp100(agent.needs.thirst - 40);
  }
}

function doGather(world: WorldState, agent: Agent, type: ResourceType): void {
  const skillKey =
    type === "food" ? (agent.skills.hunting > agent.skills.farming ? "hunting" : "farming")
    : type === "wood" || type === "stone" ? "building"
    : "scouting";
  if (canGatherAt(world, agent.position, type)) {
    const tile =
      type === "water"
        ? getTile(world, agent.position.x, agent.position.y)?.terrain === "water"
          ? getTile(world, agent.position.x, agent.position.y)
          : findAdjacentWater(world, agent.position)
        : getTile(world, agent.position.x, agent.position.y);
    const skillBonus = 1 + agent.skills[skillKey as keyof typeof agent.skills] * 0.02;
    const want = Math.round(BASE_YIELD[type] * skillBonus);
    const got = tile ? extractFromTile(tile, want) : want;
    if (got > 0) {
      addToInventory(agent.inventory, type, got);
      practiceSkill(agent.skills, skillKey as never, 0.6);
      agent.needs.energy = clamp100(agent.needs.energy + 1.2);
    }
    return;
  }
  const tile = findNearestResourceTile(world, agent.position, type);
  if (tile) moveStep(world, agent, { x: tile.x, y: tile.y }, type === "water");
}

function findAdjacentWater(world: WorldState, pos: Position) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = getTile(world, pos.x + dx, pos.y + dy);
      if (t?.terrain === "water") return t;
    }
  }
  return undefined;
}

/** Is this tile open ground we can raise a hut on? */
function isBuildable(world: WorldState, x: number, y: number): boolean {
  const t = getTile(world, x, y);
  return !!t && t.walkable && !t.shelterId && (t.terrain === "grass" || t.terrain === "farm");
}

/** Nearest open-ground tile to build on (so an agent carrying materials while
 *  standing on forest/rock walks to grass instead of getting stuck retrying). */
function findBuildSpot(world: WorldState, pos: Position): Position | undefined {
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring at radius r
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (isBuildable(world, x, y)) return { x, y };
      }
    }
  }
  return undefined;
}

function doBuild(world: WorldState, agent: Agent): void {
  let shelter = ownedUnfinishedShelter(world, agent);
  if (!shelter) {
    const hasMaterials =
      inventoryCount(agent.inventory, "wood") >= SHELTER_WOOD_COST &&
      inventoryCount(agent.inventory, "stone") >= SHELTER_STONE_COST;
    if (!hasMaterials) return;
    // Start a new shelter on the current tile if it's suitable open ground;
    // otherwise walk to the nearest buildable spot rather than spinning in place.
    const tile = getTile(world, agent.position.x, agent.position.y);
    if (tile && isBuildable(world, agent.position.x, agent.position.y)) {
      addToInventory(agent.inventory, "wood", -SHELTER_WOOD_COST);
      addToInventory(agent.inventory, "stone", -SHELTER_STONE_COST);
      const id = nextId(world, "shel");
      shelter = {
        id,
        position: { x: tile.x, y: tile.y },
        progress: 0,
        integrity: 100,
        ownerId: agent.id,
        occupantIds: [],
        groupId: agent.groupIds[0],
      };
      world.shelters[id] = shelter;
      tile.shelterId = id;
    } else {
      const spot = findBuildSpot(world, agent.position);
      if (spot) moveStep(world, agent, spot, false);
      return;
    }
  }
  // Must be on the shelter tile to build it.
  if (agent.position.x !== shelter.position.x || agent.position.y !== shelter.position.y) {
    moveStep(world, agent, shelter.position, false);
    return;
  }
  const progressGain = 12 + agent.skills.building * 0.25;
  shelter.progress = Math.min(100, shelter.progress + progressGain);
  practiceSkill(agent.skills, "building", 0.8);
  agent.needs.energy = clamp100(agent.needs.energy + 4);
  if (shelter.progress >= 100) {
    const tile = getTile(world, shelter.position.x, shelter.position.y);
    if (tile) tile.terrain = "house";
    agent.needs.shelter = clamp100(agent.needs.shelter - 60);
    logEvent(world, "shelter_built", `${agent.name} finished building a shelter.`, [agent.id], 2, {
      weight: 55,
    });
    addMemory(
      agent,
      makeMemory(world.tick, world.day, `I built a shelter.`, "achievement", 60, [])
    );
  }
}

type Shelter = WorldState["shelters"][string];

/** A shelter has room for this agent if they already hold a slot or one is free. */
function shelterRoomFor(sh: Shelter, agent: Agent): boolean {
  return sh.occupantIds.includes(agent.id) || sh.occupantIds.length < SHELTER_CAPACITY;
}

/** Claim a sleeping slot (occupantIds is reset each dawn, so it's per-night). */
function reserveShelter(sh: Shelter, agent: Agent): void {
  if (!sh.occupantIds.includes(agent.id)) sh.occupantIds.push(agent.id);
}

function doRest(world: WorldState, agent: Agent): void {
  let tile = getTile(world, agent.position.x, agent.position.y);
  let here = tile?.shelterId ? world.shelters[tile.shelterId] : undefined;
  const onUsableShelter = !!here && here.progress >= 100 && shelterRoomFor(here, agent);

  // At night (or when exposed) head for a shelter with a free slot and sleep
  // there. Once on it, don't move — sleep is meant to be a stationary stretch.
  const wantShelter = isNight(world) || agent.needs.shelter > 45;
  if (wantShelter && !onUsableShelter) {
    const sh = findUsableShelter(world, agent);
    if (sh) {
      reserveShelter(sh, agent); // hold the slot even while walking over (counts toward capacity)
      if (sh.position.x !== agent.position.x || sh.position.y !== agent.position.y) {
        moveStep(world, agent, sh.position, false); // walk to bed
        return;
      }
      tile = getTile(world, sh.position.x, sh.position.y);
      here = sh;
    }
  }

  // Per-tick rest effects are scaled to a 60-tick day so a night of sleep does
  // the same thing regardless of how long the day is (longer day = more, smaller
  // ticks). Without this, a 150-tick day's long nights pile up exposure and kill.
  const k = 60 / Math.max(1, world.config.ticksPerDay);
  const sheltered = !!here && here.progress >= 100 && shelterRoomFor(here, agent);
  if (sheltered) {
    reserveShelter(here!, agent);
    agent.needs.energy = clamp100(agent.needs.energy - 24 * k);
    agent.needs.shelter = clamp100(agent.needs.shelter - 30 * k);
    agent.needs.safety = clamp100(agent.needs.safety - 10 * k);
    agent.health = clamp100(agent.health + 0.9 * k);
  } else {
    // Sleeping rough: less restful, and exposure creeps up so they're motivated
    // to build or claim a shelter.
    agent.needs.energy = clamp100(agent.needs.energy - 14 * k);
    agent.needs.shelter = clamp100(agent.needs.shelter + 1.5 * k);
    agent.health = clamp100(agent.health + 0.5 * k);
  }
}

/** Nearest finished, non-full, reachable shelter the agent may use (own,
 *  group's, or unclaimed-by-group). */
function findUsableShelter(world: WorldState, agent: Agent): Shelter | undefined {
  let best: Shelter | undefined;
  let bestD = Infinity;
  for (const id in world.shelters) {
    const sh = world.shelters[id];
    if (sh.progress < 100) continue;
    const restricted = sh.groupId && !agent.groupIds.includes(sh.groupId) && sh.ownerId !== agent.id;
    if (restricted) continue;
    if (!shelterRoomFor(sh, agent)) continue; // full — find another / sleep rough
    const d = dist(agent.position, sh.position);
    if (d > SHELTER_SEEK_RANGE) continue;
    if (d < bestD) {
      bestD = d;
      best = sh;
    }
  }
  return best;
}

function doClean(world: WorldState, agent: Agent): void {
  const nearWater = !!findAdjacentWater(world, agent.position);
  agent.needs.hygiene = clamp100(agent.needs.hygiene - (nearWater ? 50 : 22));
  if (!nearWater) {
    // Head to water to clean properly.
    const water = findNearestResourceTile(world, agent.position, "water");
    if (water) moveStep(world, agent, { x: water.x, y: water.y }, true);
  }
}

function doTalk(world: WorldState, agent: Agent, p: Perception): void {
  const target = p.socialTarget;
  if (!target) return;
  if (!adjacent(agent.position, target.position)) {
    moveStep(world, agent, target.position, true);
    return;
  }
  const rel = getRelationship(agent, target.id);
  // Choose a tone from the relationship.
  if (rel.resentment > 55 && agent.traits.aggression > 55) {
    sendMessage(world, agent, target, "threat");
  } else if (rel.resentment > 40 && agent.traits.forgiveness > 55) {
    sendMessage(world, agent, target, "apology");
  } else if (rel.trust > 30 && agent.traits.cooperation > 55) {
    sendMessage(world, agent, target, "proposal");
  } else {
    sendMessage(world, agent, target, "greeting");
  }
  agent.needs.social = clamp100(agent.needs.social - 30);
}

function doShare(world: WorldState, agent: Agent, p: Perception): void {
  const target = p.neediest;
  if (!target) return;
  if (!adjacent(agent.position, target.position)) {
    moveStep(world, agent, target.position, true);
    return;
  }
  const give = Math.min(4, inventoryCount(agent.inventory, "food") - 2);
  if (give <= 0) return;
  addToInventory(agent.inventory, "food", -give);
  addToInventory(target.inventory, "food", give);
  applyInteraction(target, agent.id, "share"); // recipient warms to giver
  applyInteraction(agent, target.id, "greeting");
  agent.mind.emotionalState.happiness = clamp100(agent.mind.emotionalState.happiness + 3);
  addMemory(
    target,
    makeMemory(world.tick, world.day, `${agent.name} shared food with me.`, "kindness", 55, [agent.id])
  );
  logEvent(world, "share", `${agent.name} shared ${give} food with ${target.name}.`, [agent.id, target.id], 1, {
    weight: 50,
  });
}

function doTrade(world: WorldState, agent: Agent, p: Perception): void {
  const target = p.tradePartner;
  if (!target) return;
  if (!adjacent(agent.position, target.position)) {
    moveStep(world, agent, target.position, true);
    return;
  }
  // Swap surplus: whoever has wood gives 4 wood for 4 food, or vice versa.
  const aWood = inventoryCount(agent.inventory, "wood");
  const aFood = inventoryCount(agent.inventory, "food");
  let ok = false;
  if (aWood > 4 && inventoryCount(target.inventory, "food") > 4) {
    addToInventory(agent.inventory, "wood", -4);
    addToInventory(target.inventory, "wood", 4);
    addToInventory(target.inventory, "food", -4);
    addToInventory(agent.inventory, "food", 4);
    ok = true;
  } else if (aFood > 4 && inventoryCount(target.inventory, "wood") > 4) {
    addToInventory(agent.inventory, "food", -4);
    addToInventory(target.inventory, "food", 4);
    addToInventory(target.inventory, "wood", -4);
    addToInventory(agent.inventory, "wood", 4);
    ok = true;
  }
  if (ok) {
    applyInteraction(agent, target.id, "successful_trade");
    applyInteraction(target, agent.id, "successful_trade");
    practiceSkill(agent.skills, "negotiation", 0.5);
    logEvent(world, "trade", `${agent.name} traded with ${target.name}.`, [agent.id, target.id], 1, {
      weight: 35,
    });
  }
}

function doSteal(world: WorldState, agent: Agent, p: Perception, rng: Rng): void {
  const target = p.richTarget;
  if (!target) return;
  if (!adjacent(agent.position, target.position)) {
    moveStep(world, agent, target.position, true);
    return;
  }
  const amount = Math.min(rng.int(2, 5), inventoryCount(target.inventory, "food"));
  if (amount <= 0) return;
  addToInventory(target.inventory, "food", -amount);
  addToInventory(agent.inventory, "food", amount);
  practiceSkill(agent.skills, "scouting", 0.4);

  // Victim's reaction depends on whether they notice (alertness vs thief stealth).
  const noticed = rng.bool(0.7);
  if (noticed) {
    applyInteraction(target, agent.id, "steal");
    target.pendingMajorEvent = true;
    addMemory(
      target,
      makeMemory(world.tick, world.day, `${agent.name} stole food from me.`, "betrayal", 60, [agent.id])
    );
    pushAgentEvent(world, target.id, {
      tick: world.tick,
      day: world.day,
      type: "theft",
      text: `${agent.name} stole from me.`,
      otherAgentIds: [agent.id],
      emotionalWeight: 60,
    });
  }
  agent.mind.emotionalState.shame = clamp100(
    agent.mind.emotionalState.shame + (agent.traits.honesty > 50 ? 6 : 1)
  );
  logEvent(
    world,
    "theft",
    `${agent.name} stole ${amount} food from ${target.name}${noticed ? " (caught!)" : " unseen"}.`,
    [agent.id, target.id],
    2,
    { weight: 55 }
  );
}

function doAttack(world: WorldState, agent: Agent, p: Perception, rng: Rng): void {
  const target = pickAttackTarget(agent, p);
  if (!target || !target.alive) return;
  if (!adjacent(agent.position, target.position)) {
    moveStep(world, agent, target.position, true);
    return;
  }
  resolveAttack(world, agent, target, rng);
}

function doFlee(world: WorldState, agent: Agent, p: Perception, rng: Rng): void {
  const threat = p.nearestThreat;
  if (threat) {
    // Move directly away from the threat.
    const away: Position = {
      x: clampPos(agent.position.x + Math.sign(agent.position.x - threat.position.x), world.config.worldWidth),
      y: clampPos(agent.position.y + Math.sign(agent.position.y - threat.position.y), world.config.worldHeight),
    };
    const tile = getTile(world, away.x, away.y);
    if (tile && tile.walkable && tile.terrain !== "danger") {
      agent.position = away;
    } else {
      wander(world, agent, rng);
    }
    agent.needs.safety = clamp100(agent.needs.safety + 3);
  } else {
    // Flee the danger tile we're standing on.
    wander(world, agent, rng);
  }
}

function clampPos(v: number, size: number): number {
  return Math.max(0, Math.min(size - 1, v));
}

function doHeal(world: WorldState, agent: Agent, p: Perception): void {
  const target = p.injured;
  if (!target) return;
  if (!adjacent(agent.position, target.position)) {
    moveStep(world, agent, target.position, true);
    return;
  }
  if (inventoryCount(agent.inventory, "medicine") <= 0) return;
  addToInventory(agent.inventory, "medicine", -1);
  const heal = 20 + agent.skills.medicine * 0.4;
  const wasDying = target.health < 25;
  target.health = clamp100(target.health + heal);
  practiceSkill(agent.skills, "medicine", 1);
  applyInteraction(target, agent.id, wasDying ? "save_life" : "heal");
  target.pendingMajorEvent = wasDying || target.pendingMajorEvent;
  addMemory(
    target,
    makeMemory(
      world.tick,
      world.day,
      `${agent.name} healed me${wasDying ? " and saved my life" : ""}.`,
      wasDying ? "achievement" : "kindness",
      wasDying ? 85 : 50,
      [agent.id]
    )
  );
  logEvent(world, "heal", `${agent.name} healed ${target.name}.`, [agent.id, target.id], wasDying ? 2 : 1, {
    weight: wasDying ? 80 : 45,
  });
}

function doReproduce(world: WorldState, agent: Agent, p: Perception, rng: Rng): void {
  const partner = p.partner;
  if (!partner) return;
  if (!adjacent(agent.position, partner.position)) {
    moveStep(world, agent, partner.position, true);
    return;
  }
  if (pairCanReproduce(world, agent, partner)) {
    reproduce(world, [agent, partner], rng);
  }
}

function doFormGroup(world: WorldState, agent: Agent, p: Perception): void {
  const ally = p.socialTarget;
  const group = createGroup(world, agent, [
    agent.traits.fairness > 60 ? "fairness" : "strength",
    agent.traits.cooperation > 60 ? "mutual aid" : "survival",
  ]);
  if (ally && adjacent(agent.position, ally.position) && getRelationship(ally, agent.id).trust > 10) {
    joinGroup(world, ally, group);
  }
}

function doJoinGroup(world: WorldState, agent: Agent, p: Perception): void {
  const ally = p.socialTarget;
  if (!ally || ally.groupIds.length === 0) return;
  if (!adjacent(agent.position, ally.position)) {
    moveStep(world, agent, ally.position, true);
    return;
  }
  const group = world.groups[ally.groupIds[0]];
  if (group) joinGroup(world, agent, group);
}

function doCraft(agent: Agent): void {
  if (inventoryCount(agent.inventory, "wood") < 4 || inventoryCount(agent.inventory, "stone") < 2)
    return;
  addToInventory(agent.inventory, "wood", -4);
  addToInventory(agent.inventory, "stone", -2);
  addToInventory(agent.inventory, "tools", 1);
  practiceSkill(agent.skills, "crafting", 1);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runAgentTick(world: WorldState, agent: Agent, rng: Rng): void {
  if (!agent.alive) return;
  autoConsume(agent);

  const p = perceive(world, agent);
  const action = chooseAction(world, agent, p, rng);
  agent.currentAction = action;
  agent.currentTargetAgentId =
    action === "attack" || action === "steal"
      ? (p.richTarget ?? p.nearestThreat)?.id
      : action === "share_resource"
      ? p.neediest?.id
      : action === "heal"
      ? p.injured?.id
      : action === "reproduce"
      ? p.partner?.id
      : action === "talk"
      ? p.socialTarget?.id
      : undefined;

  switch (action) {
    case "gather_food":
      doGather(world, agent, "food");
      break;
    case "gather_water":
      doGather(world, agent, "water");
      break;
    case "gather_wood":
      doGather(world, agent, "wood");
      break;
    case "gather_stone":
      doGather(world, agent, "stone");
      break;
    case "build_shelter":
      doBuild(world, agent);
      break;
    case "rest":
      doRest(world, agent);
      break;
    case "clean_self":
      doClean(world, agent);
      break;
    case "talk":
      doTalk(world, agent, p);
      break;
    case "share_resource":
      doShare(world, agent, p);
      break;
    case "trade":
      doTrade(world, agent, p);
      break;
    case "steal":
      doSteal(world, agent, p, rng);
      break;
    case "attack":
      doAttack(world, agent, p, rng);
      break;
    case "flee":
      doFlee(world, agent, p, rng);
      break;
    case "heal":
      doHeal(world, agent, p);
      break;
    case "reproduce":
      doReproduce(world, agent, p, rng);
      break;
    case "form_group":
      doFormGroup(world, agent, p);
      break;
    case "join_group":
      doJoinGroup(world, agent, p);
      break;
    case "craft_tool":
      doCraft(agent);
      break;
    case "explore":
    default:
      wander(world, agent, rng);
      break;
  }

  // Update derived needs that depend on surroundings.
  updateEnvironmentalNeeds(agent, p);
}

function updateEnvironmentalNeeds(agent: Agent, p: Perception): void {
  // Safety improves with friendly company, worsens near threats / danger tiles.
  let safetyTarget = 25;
  if (p.onDanger) safetyTarget += 45;
  if (p.nearestThreat) safetyTarget += 25;
  const friends = p.nearby.filter((o) => relationshipWarmth(getRelationship(agent, o.id)) > 60).length;
  safetyTarget -= friends * 6;
  agent.needs.safety = clamp100(agent.needs.safety * 0.85 + clamp100(safetyTarget) * 0.15);

  // Social need eases near liked company.
  if (p.nearby.length > 0) {
    agent.needs.social = clamp100(agent.needs.social - 1.5);
  }

  // Danger terrain hurts.
  if (p.onDanger) {
    agent.health = clamp100(agent.health - 1.2);
  }
}
