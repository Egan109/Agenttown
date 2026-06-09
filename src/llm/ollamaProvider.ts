import type { LLMConfig, LLMProvider } from "../types";
import { type ChatFn, type ChatMessage, fetchWithTimeout, runReflectionChat } from "./chatReflection";

// Talks to a local Ollama server (default http://localhost:11434) via its native
// /api/chat endpoint. Ollama must allow the browser origin; set
// OLLAMA_ORIGINS=* (or the dev origin) in the Ollama environment — see README.

const ollamaChat: ChatFn = async (messages: ChatMessage[], config: LLMConfig) => {
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/chat`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        format: "json", // constrain output to JSON where the model supports it
        keep_alive: "30m", // keep the model resident in VRAM so reflections stay ~2-3s
        // Hybrid models (qwen3) reason in a separate channel; with thinking on
        // they can spend the whole budget thinking and emit no JSON. Default off.
        think: config.think ?? false,
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens,
        },
      }),
    },
    config.timeoutMs
  );
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await safeText(res)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
};

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

export function makeOllamaProvider(config: LLMConfig): LLMProvider {
  return {
    name: "ollama",
    generateReflection: (input) => runReflectionChat(ollamaChat, input, config),
  };
}

/** Lightweight connectivity probe used by the LLM settings panel. */
export async function pingOllama(config: LLMConfig): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchWithTimeout(
      `${config.baseUrl.replace(/\/$/, "")}/api/tags`,
      { method: "GET" },
      Math.min(8000, config.timeoutMs)
    );
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (data.models ?? []).map((m) => m.name);
    const hasModel = names.some((n) => n === config.model || n.startsWith(config.model));
    return {
      ok: true,
      detail: hasModel
        ? `Connected. Model "${config.model}" available.`
        : `Connected, but "${config.model}" not pulled. Available: ${names.slice(0, 6).join(", ") || "none"}`,
    };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
