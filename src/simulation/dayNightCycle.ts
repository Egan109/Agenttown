import type { WorldState } from "../types";

/** Fraction of the day after which it is considered night. */
export const NIGHT_THRESHOLD = 0.78;

export function isNight(world: WorldState): boolean {
  return world.timeOfDay >= NIGHT_THRESHOLD;
}

export function isDawn(world: WorldState): boolean {
  // The first tick of a new day.
  return world.tick % world.config.ticksPerDay === 0;
}

/** Advance the clock. Returns true if a new day just began (dawn). */
export function advanceClock(world: WorldState): boolean {
  world.tick++;
  const tickInDay = world.tick % world.config.ticksPerDay;
  world.timeOfDay = tickInDay / world.config.ticksPerDay;
  if (tickInDay === 0) {
    world.day++;
    return true;
  }
  return false;
}

/** A 0..1 ambient light level for rendering (bright midday, dark midnight). */
export function lightLevel(world: WorldState): number {
  // Smooth curve: brightest at ~0.4, darkest at night.
  const t = world.timeOfDay;
  if (t >= NIGHT_THRESHOLD) return 0.35;
  return 0.55 + 0.45 * Math.sin(Math.PI * (t / NIGHT_THRESHOLD));
}
