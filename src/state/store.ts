import { create } from "zustand";
import { defaultAgentSpecs } from "../config/defaultAgents";
import { cloneConfig, defaultConfig } from "../config/defaultConfig";
import { applyPreset } from "../config/presets";
import { makeAnthropicProvider } from "../llm/anthropicProvider";
import { createProvider, testConnection } from "../llm/provider";
import { runPreparedReflections, type PreparedReflection } from "../llm/reflection";
import { generateDaySummary, pushDailySummary, type ReflectionDigest } from "../llm/daySummary";
import { logEvent } from "../simulation/events";
import { computeMetrics } from "../simulation/metrics";
import { stepTick } from "../simulation/tick";
import { createWorld } from "../simulation/world";
import type {
  LLMConfig,
  LLMProvider,
  Metrics,
  SimulationConfig,
  WorldPresetName,
  WorldState,
} from "../types";
import { Rng } from "../util/rng";

const LS_KEY = "agenttown.llmconfig.v1";

// Non-reactive engine state held outside the store to avoid re-render churn.
let rng = new Rng(12345);
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let ticking = false; // re-entrancy guard: at most one sim tick body at a time
let providers: { local: LLMProvider; cloud: LLMProvider | null } = {
  local: createProvider(defaultConfig.llm),
  cloud: null,
};

function buildProviders(cfg: SimulationConfig): void {
  providers = {
    local: createProvider(cfg.llm),
    cloud:
      cfg.llm.useCloudForMajorEvents && cfg.llm.apiKey ? makeAnthropicProvider(cfg.llm) : null,
  };
}

function loadStoredLLM(): Partial<LLMConfig> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<LLMConfig>) : null;
  } catch {
    return null;
  }
}

function persistLLM(cfg: LLMConfig): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

function makeInitialConfig(): SimulationConfig {
  const cfg = cloneConfig(defaultConfig);
  const stored = loadStoredLLM();
  if (stored) cfg.llm = { ...cfg.llm, ...stored };
  return cfg;
}

export type LLMStatus = {
  reflecting: boolean;
  /** Live progress while a reflection batch runs (sim is paused during this). */
  progress?: { done: number; total: number; lastName?: string };
  lastTest?: { ok: boolean; detail: string };
  warnings: string[];
};

export type StoreState = {
  world: WorldState;
  metrics: Metrics;
  running: boolean;
  speed: number; // ticks per second
  seed: number;
  tick: number; // re-render trigger
  selectedAgentId: string | null;
  preset: WorldPresetName;
  llmStatus: LLMStatus;

  // lifecycle
  start: () => void;
  pause: () => void;
  toggleRun: () => void;
  stepOnce: () => void;
  reset: (randomizeSeed?: boolean) => void;
  setSpeed: (s: number) => void;

  // selection
  selectAgent: (id: string | null) => void;

  // config
  setPreset: (name: WorldPresetName) => void;
  updateConfig: (patch: Partial<SimulationConfig>) => void;
  updateLLMConfig: (patch: Partial<LLMConfig>) => void;
  exportConfig: () => string;
  importConfig: (json: string) => boolean;

  // llm
  testLLM: () => Promise<void>;
  pushWarning: (msg: string) => void;
};

function freshWorld(config: SimulationConfig, seed: number): WorldState {
  rng = new Rng(seed);
  const world = createWorld(config, defaultAgentSpecs, seed);
  return world;
}

export const useStore = create<StoreState>((set, get) => {
  const initialConfig = makeInitialConfig();
  buildProviders(initialConfig);
  const initialWorld = freshWorld(initialConfig, 12345);

  function scheduleLoop(): void {
    if (loopTimer) clearTimeout(loopTimer);
    if (!get().running) return;
    const interval = Math.max(15, Math.floor(1000 / get().speed));
    loopTimer = setTimeout(runLoopBody, interval);
  }

  /**
   * One tick of the sim. A single `ticking` guard guarantees only ONE body ever
   * runs at a time — so the sim never advances during a reflection pause and we
   * never spawn concurrent reflection batches, no matter how many timers fire
   * (speed changes, re-mounts, etc.).
   */
  async function runLoopBody(): Promise<void> {
    if (ticking) return; // a previous body (or its reflection await) is still in flight
    ticking = true;
    try {
      if (!get().running) return;
      const world = get().world;
      const res = stepTick(world, rng);
      set({ tick: get().tick + 1, metrics: computeMetrics(world) });
      if (res.newDay && res.prepared.length && reflectionsEnabled()) {
        // Pause: run reflections to completion (streaming each in) before next tick.
        await runReflectionsBlocking(res.prepared);
      }
    } finally {
      ticking = false;
      if (get().running) scheduleLoop();
    }
  }

  function reflectionsEnabled(): boolean {
    const llm = get().world.config.llm;
    return llm.enabled && llm.reflectionMode !== "no_llm";
  }

  /**
   * Run a reflection batch to completion while the sim is paused, streaming each
   * agent's reflection into the world log (and a progress chip) as it lands.
   */
  async function runReflectionsBlocking(prepared: PreparedReflection[]): Promise<void> {
    if (prepared.length === 0 || !reflectionsEnabled()) return;
    if (get().llmStatus.reflecting) return; // never run two batches concurrently
    set((s) => ({
      llmStatus: { ...s.llmStatus, reflecting: true, progress: { done: 0, total: prepared.length } },
    }));
    try {
      const result = await runPreparedReflections(
        get().world,
        prepared,
        providers.local,
        providers.cloud,
        get().world.config.llm,
        (msg) => get().pushWarning(msg),
        (p) =>
          set((s) => ({
            llmStatus: {
              ...s.llmStatus,
              progress: { done: p.done, total: p.total, lastName: p.agentName },
            },
            tick: s.tick + 1, // re-render so the new reflection shows immediately
            metrics: computeMetrics(get().world),
          })),
      );
      // Weave the night's reflections + the day's events into a village chronicle.
      if (result.reflected > 0) await writeDailyChronicle(result.digests);
    } catch (e) {
      get().pushWarning(`Reflection batch failed: ${(e as Error).message}`);
    }
    set((s) => ({
      llmStatus: { ...s.llmStatus, reflecting: false, progress: undefined },
      tick: s.tick + 1,
      metrics: computeMetrics(get().world),
    }));
  }

  /**
   * Build the day's chronicle from the reflections that just landed plus the
   * day's notable events, append it to the world, and drop a line in the log.
   */
  async function writeDailyChronicle(digests: ReflectionDigest[]): Promise<void> {
    const world = get().world;
    try {
      const summary = await generateDaySummary(
        world,
        digests,
        providers.local,
        world.config.llm
      );
      pushDailySummary(world, summary);
      logEvent(world, "chronicle", `📜 Day ${summary.day}: ${summary.text}`, [], 2);
      set((s) => ({ tick: s.tick + 1 }));
    } catch (e) {
      get().pushWarning(`Chronicle failed: ${(e as Error).message}`);
    }
  }

  return {
    world: initialWorld,
    metrics: computeMetrics(initialWorld),
    running: false,
    speed: 8,
    seed: 12345,
    tick: 0,
    selectedAgentId: null,
    preset: "Balanced Village",
    llmStatus: { reflecting: false, warnings: [] },

    start: () => {
      if (get().running) return;
      set({ running: true });
      scheduleLoop();
    },
    pause: () => {
      if (loopTimer) clearTimeout(loopTimer);
      loopTimer = null;
      set({ running: false });
    },
    toggleRun: () => (get().running ? get().pause() : get().start()),

    stepOnce: () => {
      const world = get().world;
      const res = stepTick(world, rng);
      set({ tick: get().tick + 1, metrics: computeMetrics(world) });
      // Stream reflections in (don't block the manual stepper's call).
      if (res.newDay && res.prepared.length) void runReflectionsBlocking(res.prepared);
    },

    reset: (randomizeSeed = false) => {
      get().pause();
      const seed = randomizeSeed ? (Math.floor(Math.random() * 2 ** 31) >>> 0) : get().seed;
      const config = get().world.config;
      const world = freshWorld(config, seed);
      set({
        world,
        seed,
        tick: 0,
        metrics: computeMetrics(world),
        selectedAgentId: null,
        llmStatus: { reflecting: false, warnings: [] },
      });
    },

    setSpeed: (s) => {
      set({ speed: s });
      if (get().running) scheduleLoop();
    },

    selectAgent: (id) => set({ selectedAgentId: id }),

    setPreset: (name) => {
      get().pause();
      const config = applyPreset(get().world.config, name);
      buildProviders(config);
      const world = freshWorld(config, get().seed);
      set({
        preset: name,
        world,
        tick: 0,
        metrics: computeMetrics(world),
        selectedAgentId: null,
      });
    },

    updateConfig: (patch) => {
      const config = { ...get().world.config, ...patch };
      // Structural changes require a rebuild; otherwise patch live.
      const structural =
        patch.worldWidth != null ||
        patch.worldHeight != null ||
        patch.startingAgentCount != null ||
        patch.resourceScarcity != null ||
        patch.resourceRegenerationRate != null;
      if (structural) {
        get().pause();
        const world = freshWorld(config, get().seed);
        set({ world, tick: 0, metrics: computeMetrics(world), selectedAgentId: null });
      } else {
        const world = get().world;
        world.config = config;
        set({ tick: get().tick + 1 });
      }
    },

    updateLLMConfig: (patch) => {
      const world = get().world;
      const llm = { ...world.config.llm, ...patch };
      world.config.llm = llm;
      buildProviders(world.config);
      persistLLM(llm);
      set({ tick: get().tick + 1 });
    },

    exportConfig: () => JSON.stringify(get().world.config, null, 2),

    importConfig: (json) => {
      try {
        const cfg = JSON.parse(json) as SimulationConfig;
        get().pause();
        buildProviders(cfg);
        const world = freshWorld(cfg, get().seed);
        set({ world, tick: 0, metrics: computeMetrics(world), selectedAgentId: null });
        persistLLM(cfg.llm);
        return true;
      } catch {
        return false;
      }
    },

    testLLM: async () => {
      const cfg = get().world.config.llm;
      const result = await testConnection(cfg);
      set((s) => ({ llmStatus: { ...s.llmStatus, lastTest: result } }));
    },

    pushWarning: (msg) =>
      set((s) => ({
        llmStatus: {
          ...s.llmStatus,
          warnings: [...s.llmStatus.warnings.slice(-12), msg],
        },
      })),
  };
});
