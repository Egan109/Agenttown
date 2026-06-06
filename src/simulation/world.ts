import type { AgentSpec } from "../agents/Agent";
import { createAgent } from "../agents/Agent";
import type {
  Agent,
  Position,
  Resource,
  ResourceType,
  SimulationConfig,
  Tile,
  WorldState,
} from "../types";
import { chebyshev, manhattan } from "../util/math";
import { hashStringToInt, Rng } from "../util/rng";

// ---------------------------------------------------------------------------
// Tile helpers
// ---------------------------------------------------------------------------

export function inBounds(world: WorldState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.config.worldWidth && y < world.config.worldHeight;
}

export function getTile(world: WorldState, x: number, y: number): Tile | undefined {
  if (!inBounds(world, x, y)) return undefined;
  return world.tiles[y][x];
}

export function neighbors4(world: WorldState, x: number, y: number): Tile[] {
  const out: Tile[] = [];
  const deltas = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  for (const [dx, dy] of deltas) {
    const t = getTile(world, x + dx, y + dy);
    if (t) out.push(t);
  }
  return out;
}

export function neighbors8(world: WorldState, x: number, y: number): Tile[] {
  const out: Tile[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const t = getTile(world, x + dx, y + dy);
      if (t) out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spatial agent queries
// ---------------------------------------------------------------------------

export function livingAgents(world: WorldState): Agent[] {
  return world.agentOrder.map((id) => world.agents[id]).filter((a) => a && a.alive);
}

export function agentsNear(
  world: WorldState,
  pos: Position,
  radius: number,
  excludeId?: string
): Agent[] {
  const out: Agent[] = [];
  for (const a of livingAgents(world)) {
    if (a.id === excludeId) continue;
    if (chebyshev(a.position.x, a.position.y, pos.x, pos.y) <= radius) out.push(a);
  }
  return out;
}

export function agentAt(world: WorldState, x: number, y: number): Agent | undefined {
  for (const a of livingAgents(world)) {
    if (a.position.x === x && a.position.y === y) return a;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Resource queries
// ---------------------------------------------------------------------------

/** Find the nearest tile that yields `type` and from which the agent can gather. */
export function findNearestResourceTile(
  world: WorldState,
  from: Position,
  type: ResourceType
): Tile | undefined {
  let best: Tile | undefined;
  let bestDist = Infinity;
  for (let y = 0; y < world.config.worldHeight; y++) {
    for (let x = 0; x < world.config.worldWidth; x++) {
      const t = world.tiles[y][x];
      if (type === "water") {
        // Water is gathered from a lake tile; we want the lake itself as target,
        // pathfinding will stop adjacent to it.
        if (t.terrain === "water") {
          const d = manhattan(from.x, from.y, x, y);
          if (d < bestDist) {
            bestDist = d;
            best = t;
          }
        }
      } else if (t.resource && t.resource.type === type && t.resource.amount > 0) {
        const d = manhattan(from.x, from.y, x, y);
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
      }
    }
  }
  return best;
}

/** True if the agent at `pos` can gather `type` right now (on or adjacent). */
export function canGatherAt(world: WorldState, pos: Position, type: ResourceType): boolean {
  if (type === "water") {
    if (getTile(world, pos.x, pos.y)?.terrain === "water") return true;
    return neighbors8(world, pos.x, pos.y).some((t) => t.terrain === "water");
  }
  const t = getTile(world, pos.x, pos.y);
  return !!(t && t.resource && t.resource.type === type && t.resource.amount > 0);
}

/** Average remaining amount of a resource across the map, used for scarcity. */
export function resourceDensity(world: WorldState, type: ResourceType): number {
  let total = 0;
  let tiles = 0;
  for (const row of world.tiles) {
    for (const t of row) {
      if (type === "water") {
        if (t.terrain === "water") {
          total += 100;
          tiles++;
        }
      } else if (t.resource && t.resource.type === type) {
        total += t.resource.amount;
        tiles++;
      }
    }
  }
  return tiles === 0 ? 0 : total / tiles;
}

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------

function makeResource(type: ResourceType, amount: number, renewable: boolean, regen?: number): Resource {
  return { type, amount, renewable, regenerationRate: regen };
}

function blankTile(x: number, y: number): Tile {
  return { x, y, terrain: "grass", walkable: true };
}

/**
 * Procedurally generate terrain and scatter resources. Density scales with
 * config.resourceScarcity (1 = abundant, 0 = barren). Deterministic given seed.
 */
export function generateTiles(config: SimulationConfig, rng: Rng): Tile[][] {
  const { worldWidth: W, worldHeight: H } = config;
  const tiles: Tile[][] = [];
  for (let y = 0; y < H; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < W; x++) row.push(blankTile(x, y));
    tiles.push(row);
  }

  const scarcity = config.resourceScarcity; // higher = more resources
  const regenMul = config.resourceRegenerationRate;

  // Lakes: a few blobs of water.
  const lakeCount = Math.max(1, Math.round(2 + scarcity * 3));
  for (let i = 0; i < lakeCount; i++) {
    const cx = rng.int(2, W - 3);
    const cy = rng.int(2, H - 3);
    const r = rng.int(1, 2);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (chebyshev(x, y, cx, cy) <= r && rng.bool(0.8)) {
          tiles[y][x].terrain = "water";
          tiles[y][x].walkable = false;
          tiles[y][x].resource = undefined;
        }
      }
    }
  }

  // Forest clusters (wood, renewable).
  const forestTiles = Math.round(W * H * 0.1 * (0.4 + scarcity));
  scatterClusters(tiles, rng, forestTiles, (t) => {
    if (t.terrain !== "grass") return;
    t.terrain = "forest";
    t.walkable = true;
    t.resource = makeResource("wood", rng.int(20, 60), true, (0.6 + scarcity) * regenMul);
  });

  // Rock outcrops (stone, mostly non-renewable).
  const rockTiles = Math.round(W * H * 0.05 * (0.4 + scarcity));
  scatterClusters(tiles, rng, rockTiles, (t) => {
    if (t.terrain !== "grass") return;
    t.terrain = "rock";
    t.walkable = true;
    t.resource = makeResource("stone", rng.int(15, 45), false);
  });

  // Berry/food patches on grass (renewable).
  const foodTiles = Math.round(W * H * 0.09 * (0.3 + scarcity * 1.2));
  scatterScattered(tiles, rng, foodTiles, (t) => {
    if (t.terrain !== "grass" || t.resource) return;
    t.resource = makeResource("food", rng.int(15, 40), true, (0.8 + scarcity) * regenMul);
  });

  // A couple of seeded farms (denser renewable food).
  const farmTiles = Math.max(2, Math.round(scarcity * 6));
  scatterScattered(tiles, rng, farmTiles, (t) => {
    if (t.terrain !== "grass" || t.resource) return;
    t.terrain = "farm";
    t.resource = makeResource("food", rng.int(30, 60), true, (1.2 + scarcity) * regenMul);
  });

  // Medicine herbs (rare, renewable but slow).
  const herbTiles = Math.max(1, Math.round(W * H * 0.012 * (0.3 + scarcity)));
  scatterScattered(tiles, rng, herbTiles, (t) => {
    if (t.terrain !== "grass" || t.resource) return;
    t.resource = makeResource("medicine", rng.int(4, 12), true, 0.2 * regenMul);
  });

  // Danger zones (hostile terrain — predators, bog, etc.).
  const dangerTiles = Math.round(W * H * 0.02);
  scatterScattered(tiles, rng, dangerTiles, (t) => {
    if (t.terrain !== "grass" || t.resource) return;
    t.terrain = "danger";
    t.walkable = true;
  });

  return tiles;
}

function scatterClusters(
  tiles: Tile[][],
  rng: Rng,
  count: number,
  apply: (t: Tile) => void
): void {
  const H = tiles.length;
  const W = tiles[0].length;
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 20) {
    guard++;
    const cx = rng.int(0, W - 1);
    const cy = rng.int(0, H - 1);
    const blob = rng.int(2, 5);
    for (let i = 0; i < blob && placed < count; i++) {
      const x = Math.min(W - 1, Math.max(0, cx + rng.int(-2, 2)));
      const y = Math.min(H - 1, Math.max(0, cy + rng.int(-2, 2)));
      const before = tiles[y][x].terrain;
      apply(tiles[y][x]);
      if (tiles[y][x].terrain !== before || tiles[y][x].resource) placed++;
    }
  }
}

function scatterScattered(
  tiles: Tile[][],
  rng: Rng,
  count: number,
  apply: (t: Tile) => void
): void {
  const H = tiles.length;
  const W = tiles[0].length;
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 30) {
    guard++;
    const x = rng.int(0, W - 1);
    const y = rng.int(0, H - 1);
    const hadResource = !!tiles[y][x].resource;
    const before = tiles[y][x].terrain;
    apply(tiles[y][x]);
    if (tiles[y][x].terrain !== before || (!hadResource && tiles[y][x].resource)) placed++;
  }
}

function findWalkableSpawn(tiles: Tile[][], rng: Rng): Position {
  const H = tiles.length;
  const W = tiles[0].length;
  for (let tries = 0; tries < 500; tries++) {
    const x = rng.int(0, W - 1);
    const y = rng.int(0, H - 1);
    if (tiles[y][x].walkable && tiles[y][x].terrain !== "danger") return { x, y };
  }
  return { x: 1, y: 1 };
}

/** Build a fresh world from config + agent specs. */
export function createWorld(
  config: SimulationConfig,
  agentSpecs: AgentSpec[],
  seed = 12345
): WorldState {
  const rng = new Rng(seed);
  const tiles = generateTiles(config, rng);

  const agents: Record<string, Agent> = {};
  const agentOrder: string[] = [];
  const count = Math.min(config.startingAgentCount, agentSpecs.length || config.startingAgentCount);

  for (let i = 0; i < count; i++) {
    const spec = agentSpecs[i % agentSpecs.length];
    // If we ran past the provided specs (overcrowded preset), clone with new ids.
    const id =
      i < agentSpecs.length ? spec.id : `${spec.id}_x${i}`;
    const name = i < agentSpecs.length ? spec.name : `${spec.name} II`;
    const agent = createAgent({ ...spec, id, name });
    agent.position = findWalkableSpawn(tiles, rng);
    agents[id] = agent;
    agentOrder.push(id);
  }

  const world: WorldState = {
    config,
    tiles,
    agents,
    agentOrder,
    shelters: {},
    groups: {},
    messages: [],
    events: [],
    dailyAgentEvents: {},
    tick: 0,
    day: 1,
    timeOfDay: 0,
    birthsToday: 0,
    deathsToday: 0,
    conflictsToday: 0,
    totalBirths: 0,
    totalDeaths: 0,
    attackEventsRolling: [],
    rngState: rng.state,
  };
  return world;
}

/** Stable next-id generator for runtime-created agents/shelters/groups. */
export function nextId(world: WorldState, prefix: string): string {
  // Mix world state so ids are unique and deterministic across a run.
  const n = hashStringToInt(`${prefix}:${world.tick}:${world.totalBirths}:${world.agentOrder.length}`);
  return `${prefix}_${n.toString(36)}`;
}
