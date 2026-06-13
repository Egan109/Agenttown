import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import { lightLevel } from "../simulation/dayNightCycle";
import type { AgentAction, EmotionalState, Shelter, TerrainType, WorldState } from "../types";

const TERRAIN_COLORS: Record<TerrainType, string> = {
  grass: "#2c3a26",
  water: "#1c3a55",
  forest: "#1d3a22",
  rock: "#3a3a40",
  farm: "#4a3f1e",
  house: "#5a3f24",
  empty: "#161616",
  danger: "#3a1d1d",
};

const RESOURCE_COLORS: Record<string, string> = {
  food: "#7bd36b",
  wood: "#b07b3f",
  stone: "#9aa0a8",
  medicine: "#e879c0",
  tools: "#d8c84a",
  luxury: "#c77dff",
  water: "#5ab0ff",
};

// A small emoji per action so the map reads as a living scene at a glance.
const ACTION_GLYPH: Partial<Record<AgentAction, string>> = {
  gather_food: "🌾",
  gather_water: "💧",
  gather_wood: "🪵",
  gather_stone: "🪨",
  build_shelter: "🔨",
  rest: "💤",
  clean_self: "🧼",
  talk: "💬",
  trade: "🤝",
  share_resource: "🎁",
  steal: "🥷",
  attack: "⚔️",
  flee: "🏃",
  heal: "➕",
  teach: "📚",
  craft_tool: "🛠️",
  reproduce: "❤️",
  form_group: "👥",
  join_group: "👥",
  leave_group: "🚪",
  propose_law: "📜",
  explore: "🧭",
  // move / idle: intentionally no glyph (avoids clutter for the common case)
};

export function WorldView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selectAgent = useStore((s) => s.selectAgent);

  // Click -> select agent at the clicked tile.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onClick = (e: MouseEvent) => {
      const world = useStore.getState().world;
      const geom = computeGeom(canvas, world);
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const tx = Math.floor((px - geom.ox) / geom.cell);
      const ty = Math.floor((py - geom.oy) / geom.cell);
      let found: string | null = null;
      let bestD = Infinity;
      for (const id of world.agentOrder) {
        const a = world.agents[id];
        if (!a || !a.alive) continue;
        const d = Math.abs(a.position.x - tx) + Math.abs(a.position.y - ty);
        if (d < bestD && d <= 1) {
          bestD = d;
          found = id;
        }
      }
      selectAgent(found);
    };
    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [selectAgent]);

  // Render loop (independent of React; reads store directly for performance).
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (canvas && wrap) {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) drawWorld(ctx, canvas, useStore.getState().world, useStore.getState().selectedAgentId);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", cursor: "pointer", display: "block" }} />
    </div>
  );
}

type Geom = { cell: number; ox: number; oy: number };

function computeGeom(canvas: HTMLCanvasElement, world: WorldState): Geom {
  const W = world.config.worldWidth;
  const H = world.config.worldHeight;
  const cell = Math.floor(Math.min(canvas.width / W, canvas.height / H));
  const ox = Math.floor((canvas.width - cell * W) / 2);
  const oy = Math.floor((canvas.height - cell * H) / 2);
  return { cell: Math.max(1, cell), ox, oy };
}

function drawWorld(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  world: WorldState,
  selectedId: string | null
) {
  const { cell, ox, oy } = computeGeom(canvas, world);
  ctx.fillStyle = "#0e1116";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Terrain + resources.
  for (let y = 0; y < world.config.worldHeight; y++) {
    for (let x = 0; x < world.config.worldWidth; x++) {
      const t = world.tiles[y][x];
      const sx = ox + x * cell;
      const sy = oy + y * cell;
      ctx.fillStyle = TERRAIN_COLORS[t.terrain];
      ctx.fillRect(sx, sy, cell - 1, cell - 1);

      if (t.resource && t.resource.amount > 0 && cell > 4) {
        // Radius (not just alpha) tracks the remaining amount, so a tile visibly
        // shrinks as it's gathered and pops back after the daily regen.
        const a = Math.min(1, t.resource.amount / 30);
        const r = Math.max(1.2, cell * (0.09 + 0.18 * a));
        ctx.fillStyle = RESOURCE_COLORS[t.resource.type] ?? "#fff";
        ctx.globalAlpha = 0.35 + a * 0.6;
        ctx.beginPath();
        ctx.arc(sx + cell * 0.5, sy + cell * 0.5, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (t.shelterId && cell > 4) {
        drawShelter(ctx, world.shelters[t.shelterId], sx, sy, cell);
      }
    }
  }

  // Agents.
  for (const id of world.agentOrder) {
    const a = world.agents[id];
    if (!a || !a.alive) continue;
    const cx = ox + a.position.x * cell + cell * 0.5;
    const cy = oy + a.position.y * cell + cell * 0.5;
    const r = Math.max(2.5, cell * 0.36);

    // Body.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = a.color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();

    // Emotive face (only when the head is big enough to read).
    if (r >= 6.5) {
      drawFace(ctx, cx, cy, r, dominantMood(a.mind.emotionalState));
    }

    // Health arc (red when low).
    if (a.health < 100 && cell > 6) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1.5, -Math.PI / 2, -Math.PI / 2 + (a.health / 100) * Math.PI * 2);
      ctx.strokeStyle = a.health > 50 ? "#4ade80" : a.health > 25 ? "#fbbf24" : "#f87171";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "butt";
      ctx.stroke();
    }

    // Selection ring.
    if (id === selectedId) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Floating name above the head.
    if (cell >= 11) {
      const fs = Math.max(8, Math.min(13, Math.floor(cell * 0.5)));
      ctx.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const ty = cy - r - 4;
      const tw = ctx.measureText(a.name).width;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(cx - tw / 2 - 3, ty - fs, tw + 6, fs + 4);
      ctx.fillStyle = id === selectedId ? "#ffffff" : "#dfe6ee";
      ctx.fillText(a.name, cx, ty);
    }

    // Current-action glyph below the head, so the player can read what each
    // villager is doing right now (gathering, building, fighting, resting…).
    const glyph = ACTION_GLYPH[a.currentAction ?? "idle"];
    if (glyph && cell >= 10) {
      const fs = Math.max(9, Math.min(15, Math.floor(cell * 0.6)));
      ctx.font = `${fs}px -apple-system, "Segoe UI Emoji", "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, cx, cy + r + fs * 0.65);
    }
  }

  // Day/night tint.
  const light = lightLevel(world);
  if (light < 1) {
    ctx.fillStyle = `rgba(8, 10, 30, ${(1 - light) * 0.45})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

/** Draw a shelter tile: a translucent base, a build-progress bar while under
 *  construction, and a roof glyph once finished — so raising a shelter is
 *  obvious on the map. */
function drawShelter(
  ctx: CanvasRenderingContext2D,
  sh: Shelter | undefined,
  sx: number,
  sy: number,
  cell: number
): void {
  const built = !!sh && sh.progress >= 100;
  const accent = built ? "#d8c84a" : "#8a7a3a";

  // Translucent footprint.
  ctx.fillStyle = built ? "rgba(216,200,74,0.20)" : "rgba(138,122,58,0.14)";
  ctx.fillRect(sx, sy, cell - 1, cell - 1);

  // Border (dashed while building).
  ctx.strokeStyle = accent;
  ctx.lineWidth = built ? 1.8 : 1;
  if (!built) ctx.setLineDash([2, 2]);
  ctx.strokeRect(sx + 1, sy + 1, cell - 3, cell - 3);
  ctx.setLineDash([]);

  if (built && cell > 8) {
    // Little roof triangle as a finished marker.
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(sx + cell * 0.5, sy + cell * 0.18);
    ctx.lineTo(sx + cell * 0.8, sy + cell * 0.46);
    ctx.lineTo(sx + cell * 0.2, sy + cell * 0.46);
    ctx.closePath();
    ctx.fill();
  } else if (!built && sh && cell > 6) {
    // Build-progress bar across the bottom of the tile.
    const p = Math.max(0, Math.min(1, sh.progress / 100));
    const bw = cell - 5;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(sx + 2, sy + cell - 4, bw, 2);
    ctx.fillStyle = accent;
    ctx.fillRect(sx + 2, sy + cell - 4, bw * p, 2);
  }
}

type Mood = "happy" | "angry" | "fear" | "sad" | "neutral";

/** Pick the expression that best summarises an agent's emotional state. */
function dominantMood(e: EmotionalState): Mood {
  const sad = Math.max(e.grief, e.loneliness * 0.7);
  const negs: [Mood, number][] = [
    ["angry", e.anger],
    ["fear", e.fear],
    ["sad", sad],
  ];
  negs.sort((a, b) => b[1] - a[1]);
  const [topMood, topVal] = negs[0];
  // A strong negative emotion that outweighs happiness shows on the face.
  if (topVal >= 40 && topVal >= e.happiness) return topMood;
  if (e.happiness >= 62) return "happy";
  return "neutral";
}

/** Draw eyes / brows / mouth for a mood, centred on the agent's body circle. */
function drawFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, mood: Mood) {
  const ink = "rgba(12,16,22,0.9)";
  const eyeY = cy - r * 0.18;
  const eyeDX = r * 0.36;
  const eyeR = Math.max(0.8, r * 0.12);
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.lineCap = "round";

  // Eyes.
  if (mood === "fear") {
    for (const dx of [-eyeDX, eyeDX]) {
      ctx.beginPath();
      ctx.arc(cx + dx, eyeY, eyeR * 1.45, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + dx, eyeY, eyeR * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
    }
  } else {
    ctx.fillStyle = ink;
    for (const dx of [-eyeDX, eyeDX]) {
      ctx.beginPath();
      ctx.arc(cx + dx, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Angry brows slanting down toward the centre.
  if (mood === "angry") {
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.moveTo(cx - eyeDX - eyeR, eyeY - r * 0.34);
    ctx.lineTo(cx - eyeDX + eyeR, eyeY - r * 0.12);
    ctx.moveTo(cx + eyeDX + eyeR, eyeY - r * 0.34);
    ctx.lineTo(cx + eyeDX - eyeR, eyeY - r * 0.12);
    ctx.stroke();
  }

  // Mouth.
  ctx.strokeStyle = ink;
  ctx.beginPath();
  const mw = r * 0.42;
  if (mood === "happy") {
    ctx.arc(cx, cy + r * 0.08, mw, 0.15 * Math.PI, 0.85 * Math.PI); // smile
  } else if (mood === "sad") {
    ctx.arc(cx, cy + r * 0.58, mw, 1.18 * Math.PI, 1.82 * Math.PI); // frown
  } else if (mood === "fear") {
    ctx.arc(cx, cy + r * 0.34, r * 0.18, 0, Math.PI * 2); // open "o"
  } else if (mood === "angry") {
    ctx.moveTo(cx - mw * 0.8, cy + r * 0.44);
    ctx.lineTo(cx + mw * 0.8, cy + r * 0.34); // tight slanted line
  } else {
    ctx.moveTo(cx - mw * 0.7, cy + r * 0.36);
    ctx.lineTo(cx + mw * 0.7, cy + r * 0.36); // neutral line
  }
  ctx.stroke();
  ctx.lineCap = "butt";
}
