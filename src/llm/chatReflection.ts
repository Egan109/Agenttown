import type { LLMConfig, NightlyReflectionInput, NightlyReflectionOutput } from "../types";
import {
  buildReflectionUserPrompt,
  REFLECTION_SYSTEM_PROMPT,
  REPAIR_INSTRUCTION,
} from "./promptBuilder";
import { parseLooseJson } from "./repairJson";
import { normalizeReflection } from "./schemas";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** A provider-specific function that turns a chat into raw text. */
export type ChatFn = (messages: ChatMessage[], config: LLMConfig) => Promise<string>;

/**
 * Run a single nightly reflection through a chat-based provider:
 *   build prompt -> call model -> parse JSON -> validate/clamp via Zod.
 * On invalid JSON it retries once with a repair instruction. If still invalid it
 * throws, so the orchestrator can apply the deterministic fallback instead.
 */
export async function runReflectionChat(
  chat: ChatFn,
  input: NightlyReflectionInput,
  config: LLMConfig
): Promise<NightlyReflectionOutput> {
  const userPrompt = buildReflectionUserPrompt(input);
  const messages: ChatMessage[] = [
    { role: "system", content: REFLECTION_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const first = await chat(messages, config);
  const parsedFirst = parseLooseJson(first);
  const normFirst = parsedFirst != null ? normalizeReflection(parsedFirst) : null;
  if (normFirst) return normFirst;

  // Retry once with the model's own (bad) output plus a repair nudge.
  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: first.slice(0, 2000) },
    { role: "user", content: REPAIR_INSTRUCTION },
  ];
  const second = await chat(repairMessages, config);
  const parsedSecond = parseLooseJson(second);
  const normSecond = parsedSecond != null ? normalizeReflection(parsedSecond) : null;
  if (normSecond) return normSecond;

  throw new Error("LLM returned unparseable reflection JSON after retry");
}

/** fetch with an abort-based timeout. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
