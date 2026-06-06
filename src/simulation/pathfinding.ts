import type { Position, WorldState } from "../types";
import { getTile, inBounds } from "./world";

/**
 * Breadth-first pathfinding on the walkable grid (4-connected). Returns the list
 * of steps from (but not including) the start to the goal. If `adjacentOk` is
 * set, a path that ends on any tile orthogonally adjacent to the goal counts as
 * success — used for gathering from non-walkable water tiles.
 *
 * Kept simple (BFS, uniform cost) because worlds are small; swap for A* if maps
 * grow large.
 */
export function findPath(
  world: WorldState,
  start: Position,
  goal: Position,
  opts: { adjacentOk?: boolean; maxNodes?: number } = {}
): Position[] | null {
  const { adjacentOk = false, maxNodes = 4000 } = opts;
  if (start.x === goal.x && start.y === goal.y) return [];

  const W = world.config.worldWidth;
  const key = (x: number, y: number) => y * W + x;
  const visited = new Set<number>([key(start.x, start.y)]);
  const cameFrom = new Map<number, number>();
  const queue: Position[] = [start];
  let head = 0;
  let nodes = 0;

  const isGoal = (x: number, y: number): boolean => {
    if (x === goal.x && y === goal.y) return true;
    if (adjacentOk) {
      return Math.abs(x - goal.x) + Math.abs(y - goal.y) === 1;
    }
    return false;
  };

  while (head < queue.length && nodes < maxNodes) {
    const cur = queue[head++];
    nodes++;
    const deltas = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const [dx, dy] of deltas) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(world, nx, ny)) continue;
      const k = key(nx, ny);
      if (visited.has(k)) continue;

      const reachedGoal = isGoal(nx, ny);
      const tile = getTile(world, nx, ny);
      // The goal tile itself may be non-walkable (water) when adjacentOk; in that
      // case we never step onto it, we just stop next to it.
      if (!reachedGoal && (!tile || !tile.walkable)) continue;

      visited.add(k);
      cameFrom.set(k, key(cur.x, cur.y));

      if (reachedGoal && (adjacentOk ? true : tile?.walkable)) {
        // Reconstruct path.
        const path: Position[] = [{ x: nx, y: ny }];
        let ck = k;
        while (cameFrom.has(ck)) {
          const pk = cameFrom.get(ck)!;
          const px = pk % W;
          const py = Math.floor(pk / W);
          if (px === start.x && py === start.y) break;
          path.push({ x: px, y: py });
          ck = pk;
        }
        path.reverse();
        // If we stopped adjacent to a non-walkable goal, drop the final non-walkable step.
        if (adjacentOk && tile && !tile.walkable) {
          path.pop();
        }
        return path;
      }

      if (tile?.walkable) queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/** One greedy step toward goal, ignoring obstacles — fallback for wandering. */
export function stepToward(start: Position, goal: Position): Position {
  const dx = Math.sign(goal.x - start.x);
  const dy = Math.sign(goal.y - start.y);
  // Prefer the larger axis to look more natural.
  if (Math.abs(goal.x - start.x) >= Math.abs(goal.y - start.y)) {
    return { x: start.x + dx, y: start.y };
  }
  return { x: start.x, y: start.y + dy };
}
