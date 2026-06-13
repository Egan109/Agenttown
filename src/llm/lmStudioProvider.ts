import type { LLMConfig, LLMProvider, LLMProviderName } from "../types";
import { type ChatFn, type ChatMessage, fetchWithTimeout, runReflectionChat } from "./chatReflection";

// OpenAI-compatible chat completions. Covers LM Studio (default
// http://localhost:1234/v1), llama.cpp servers, and OpenAI itself. The only
// differences are the base URL and whether an API key is required.

function openAICompatChat(): ChatFn {
  return async (messages: ChatMessage[], config: LLMConfig) => {
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          // Ask for a JSON object where supported (ignored by servers that don't).
          response_format: { type: "json_object" },
        }),
      },
      config.timeoutMs
    );
    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}: ${await safeText(res)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  };
}

export function makeOpenAICompatibleProvider(
  config: LLMConfig,
  name: LLMProviderName
): LLMProvider {
  const chat = openAICompatChat();
  return {
    name,
    generateReflection: (input) => runReflectionChat(chat, input, config),
    // JSON-constrained chronicle generation reuses the same response_format path.
    generateJson: (system, user) =>
      chat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        config
      ),
  };
}

export function makeLmStudioProvider(config: LLMConfig): LLMProvider {
  return makeOpenAICompatibleProvider(config, "lmstudio");
}

export function makeOpenAIProvider(config: LLMConfig): LLMProvider {
  return makeOpenAICompatibleProvider(config, "openai");
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

/** Probe an OpenAI-compatible /models endpoint. */
export async function pingOpenAICompatible(
  config: LLMConfig
): Promise<{ ok: boolean; detail: string }> {
  try {
    const base = config.baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
    const res = await fetchWithTimeout(
      `${base}/models`,
      { method: "GET", headers },
      Math.min(8000, config.timeoutMs)
    );
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (data.data ?? []).map((m) => m.id);
    return {
      ok: true,
      detail: `Connected. ${ids.length} model(s) available${
        ids.length ? `: ${ids.slice(0, 5).join(", ")}` : ""
      }.`,
    };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
