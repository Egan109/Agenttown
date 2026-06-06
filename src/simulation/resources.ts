import type { ResourceType, Tile, WorldState } from "../types";

export const GATHERABLE: ResourceType[] = ["food", "water", "wood", "stone", "medicine"];

/** How much a single gather action yields, before skill bonuses. */
export const BASE_YIELD: Record<ResourceType, number> = {
  food: 4,
  water: 6,
  wood: 3,
  stone: 2,
  medicine: 1,
  tools: 0,
  luxury: 0,
};

/**
 * Remove resource from a tile and return how much was actually taken. Water is
 * treated as effectively infinite (it comes from a lake), so it does not deplete.
 */
export function extractFromTile(tile: Tile, requested: number): number {
  if (tile.terrain === "water") return requested; // lakes don't run dry
  if (!tile.resource) return 0;
  const taken = Math.min(tile.resource.amount, requested);
  tile.resource.amount -= taken;
  if (tile.resource.amount <= 0 && !tile.resource.renewable) {
    // Non-renewable tiles become barren (e.g. mined-out rock).
    tile.resource = undefined;
    if (tile.terrain === "rock") tile.terrain = "grass";
  }
  return taken;
}

/** Regenerate renewable resources. Called once per in-game day at dawn. */
export function regenerateResources(world: WorldState): void {
  for (const row of world.tiles) {
    for (const t of row) {
      const r = t.resource;
      if (!r || !r.renewable) continue;
      const cap = capForTerrain(t.terrain);
      if (r.amount < cap) {
        r.amount = Math.min(cap, r.amount + (r.regenerationRate ?? 0.5));
      }
    }
  }
}

function capForTerrain(terrain: Tile["terrain"]): number {
  switch (terrain) {
    case "farm":
      return 70;
    case "forest":
      return 70;
    case "grass":
      return 45;
    default:
      return 40;
  }
}
