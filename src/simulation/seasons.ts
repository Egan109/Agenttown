// Seasonal boom-and-famine cycle. Seasons are derived purely from world.day
// (no extra state to serialize, fully deterministic). They modulate how fast
// renewable resources regrow: a generous spring/summer, a lean autumn, and a
// harsh winter that forces the village to live off stored food.

export type Season = "spring" | "summer" | "autumn" | "winter";

/** Days each season lasts. Four seasons => a 4*N-day year. */
export const SEASON_LENGTH_DAYS = 7;

const ORDER: Season[] = ["spring", "summer", "autumn", "winter"];

/** Multiplier applied to renewable regen during each season. Winter is the
 *  pinch point; spring the recovery. Tuned so a prepared village survives. */
export const SEASON_REGEN_MUL: Record<Season, number> = {
  spring: 1.3,
  summer: 1.0,
  autumn: 0.6,
  winter: 0.25,
};

export const SEASON_LABEL: Record<Season, string> = {
  spring: "🌱 Spring",
  summer: "☀️ Summer",
  autumn: "🍂 Autumn",
  winter: "❄️ Winter",
};

/** Short flavour line logged when a season begins. */
export const SEASON_HERALD: Record<Season, string> = {
  spring: "🌱 Spring returns — the land greens and food grows freely again.",
  summer: "☀️ Summer settles in — harvests are steady and warm.",
  autumn: "🍂 Autumn arrives — growth slows; wise villagers begin to store food.",
  winter: "❄️ Winter bites — little grows now. The granaries will be tested.",
};

export function seasonForDay(day: number): Season {
  const idx = Math.floor(day / SEASON_LENGTH_DAYS) % ORDER.length;
  return ORDER[((idx % ORDER.length) + ORDER.length) % ORDER.length];
}

/** Regen multiplier for the given day (1 if seasons are disabled). */
export function seasonRegenMultiplier(day: number, seasonsEnabled: boolean): number {
  if (!seasonsEnabled) return 1;
  return SEASON_REGEN_MUL[seasonForDay(day)];
}
