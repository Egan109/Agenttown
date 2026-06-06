import { addToInventory, inventoryCount } from "../agents/Agent";
import { addMemory, makeMemory } from "../agents/memory";
import { applyInteraction, getRelationship } from "../agents/relationships";
import { practiceSkill } from "../agents/skills";
import type { Agent, WorldState } from "../types";
import { clamp100 } from "../util/math";
import type { Rng } from "../util/rng";
import { logEvent } from "./events";
import { killAgent } from "./lifecycle";

/** Raw combat power of an agent in a fight. */
export function combatPower(a: Agent): number {
  const toolBonus = inventoryCount(a.inventory, "tools") > 0 ? 12 : 0;
  return (
    a.skills.combat * 0.5 +
    a.traits.aggression * 0.3 +
    a.traits.courage * 0.2 +
    a.traits.intimidation * 0.1 +
    a.health * 0.2 +
    toolBonus
  );
}

export type AttackResult = {
  defenderDied: boolean;
  attackerDied: boolean;
  damageToDefender: number;
  damageToAttacker: number;
  lootedFood: number;
};

/**
 * Resolve one round of violence. The aggressor strikes; the defender strikes
 * back unless badly outmatched or submissive. Death is possible. All physical
 * outcomes (HP, loot, death) are applied here — the source of truth. Emotional
 * fallout (hatred, fear, grief) is left for relationships + nightly reflection.
 */
export function resolveAttack(
  world: WorldState,
  attacker: Agent,
  defender: Agent,
  rng: Rng
): AttackResult {
  const ap = combatPower(attacker) + rng.float(0, 20);
  const dp = combatPower(defender) + rng.float(0, 20);

  // Damage to defender scales with how much the attacker overpowers them.
  const dmgToDefender = clamp100(14 + (ap - dp) * 0.4 + rng.float(0, 10));
  defender.health = clamp100(defender.health - dmgToDefender);

  // Counterattack unless the defender is broken or very submissive/afraid.
  const defRel = getRelationship(defender, attacker.id);
  const willCounter =
    defender.health > 0 &&
    defender.traits.submissiveness < 70 &&
    defRel.fear < 80 &&
    rng.bool(0.7);
  let dmgToAttacker = 0;
  if (willCounter) {
    dmgToAttacker = clamp100(8 + (dp - ap) * 0.3 + rng.float(0, 8));
    dmgToAttacker = Math.max(0, dmgToAttacker);
    attacker.health = clamp100(attacker.health - dmgToAttacker);
  }

  // Relationship fallout.
  applyInteraction(defender, attacker.id, "attack");
  // The attacker also loses some warmth toward a target they've now hurt.
  const atkRel = getRelationship(attacker, defender.id);
  atkRel.affection = Math.max(-100, atkRel.affection - 8);
  atkRel.resentment = clamp100(atkRel.resentment + 6);

  practiceSkill(attacker.skills, "combat", 1.4);
  if (willCounter) practiceSkill(defender.skills, "combat", 1);

  defender.pendingMajorEvent = true;
  attacker.pendingMajorEvent = true;

  // Memories.
  addMemory(
    defender,
    makeMemory(
      world.tick,
      world.day,
      `${attacker.name} attacked me.`,
      defender.health < 25 ? "trauma" : "conflict",
      defender.health < 25 ? 90 : 65,
      [attacker.id]
    )
  );

  let lootedFood = 0;
  let defenderDied = false;
  let attackerDied = false;

  if (defender.health <= 0) {
    // Aggressor may loot the fallen.
    const food = inventoryCount(defender.inventory, "food");
    if (food > 0) {
      lootedFood = food;
      addToInventory(attacker.inventory, "food", food);
      defender.inventory.food = 0;
    }
    killAgent(world, defender, `killed by ${attacker.name}`);
    defenderDied = true;
    addMemory(
      attacker,
      makeMemory(world.tick, world.day, `I killed ${defender.name}.`, "trauma", 80, [defender.id])
    );
  }

  if (attacker.health <= 0) {
    killAgent(world, attacker, `died fighting ${defender.name}`);
    attackerDied = true;
  }

  world.conflictsToday++;
  logEvent(
    world,
    "attack",
    `${attacker.name} attacked ${defender.name}` +
      (defenderDied ? ` and killed them` : ` (dealt ${Math.round(dmgToDefender)} dmg)`) +
      (lootedFood > 0 ? `, looting ${lootedFood} food` : ``),
    [attacker.id, defender.id],
    defenderDied ? 3 : 2,
    { weight: defenderDied ? 95 : 70 }
  );

  return {
    defenderDied,
    attackerDied,
    damageToDefender: dmgToDefender,
    damageToAttacker: dmgToAttacker,
    lootedFood,
  };
}
