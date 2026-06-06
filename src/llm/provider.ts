import type { LLMConfig, LLMProvider } from "../types";
import { makeAnthropicProvider } from "./anthropicProvider";
import { makeLmStudioProvider, makeOpenAIProvider, pingOpenAICompatible } from "./lmStudioProvider";
import { makeMockProvider } from "./mockProvider";
import { makeOllamaProvider, pingOllama } from "./ollamaProvider";

/** Build the active provider for a given config. Cheap — recreate on config change. */
export function createProvider(config: LLMConfig): LLMProvider {
  if (!config.enabled) return makeMockProvider();
  switch (config.provider) {
    case "ollama":
      return makeOllamaProvider(config);
    case "lmstudio":
      return makeLmStudioProvider(config);
    case "openai":
      return makeOpenAIProvider(config);
    case "anthropic":
      return makeAnthropicProvider(config);
    case "mock":
    default:
      return makeMockProvider();
  }
}

/** Probe connectivity for the settings panel "Test connection" button. */
export async function testConnection(
  config: LLMConfig
): Promise<{ ok: boolean; detail: string }> {
  switch (config.provider) {
    case "ollama":
      return pingOllama(config);
    case "lmstudio":
    case "openai":
      return pingOpenAICompatible(config);
    case "anthropic":
      return config.apiKey
        ? { ok: true, detail: "API key set (no preflight call made to save quota)." }
        : { ok: false, detail: "No API key set." };
    case "mock":
    default:
      return { ok: true, detail: "Mock provider is always available." };
  }
}
