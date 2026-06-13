import type { LLMConfig, LLMProvider, NightlyReflectionInput, NightlyReflectionOutput } from "../types";
import { type ChatMessage, fetchWithTimeout } from "./chatReflection";
import { buildReflectionUserPrompt, REFLECTION_SYSTEM_PROMPT, REPAIR_INSTRUCTION } from "./promptBuilder";
import { parseLooseJson } from "./repairJson";
import { normalizeReflection } from "./schemas";

// Optional cloud provider for rare "major story moments". Uses the Anthropic
// Messages API (POST /v1/messages). Calling Anthropic directly from a browser
// requires the dangerous-direct-browser-access header and CORS; in production
// you'd proxy this through a backend, but for a local toy sim direct is fine.
//
// Model IDs (current as of build): claude-opus-4-8, claude-sonnet-4-6,
// claude-haiku-4-5. Default cloud model is claude-sonnet-4-6 (see defaultConfig).
//
// Note: the Messages API takes `system` as a TOP-LEVEL field, not a message
// role, so we split our system/user/assistant chat accordingly. We omit
// `temperature` because Opus 4.8/4.7 reject it (400); Sonnet still works without.

const ANTHROPIC_VERSION = "2023-06-01";

async function anthropicMessages(
  messages: ChatMessage[],
  config: LLMConfig
): Promise<string> {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const model = config.cloudModel || "claude-sonnet-4-6";
  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey ?? "",
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: config.maxTokens,
        system: systemText,
        messages: turns,
      }),
    },
    config.timeoutMs
  );
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

async function generateReflection(
  input: NightlyReflectionInput,
  config: LLMConfig
): Promise<NightlyReflectionOutput> {
  const messages: ChatMessage[] = [
    { role: "system", content: REFLECTION_SYSTEM_PROMPT },
    { role: "user", content: buildReflectionUserPrompt(input) },
  ];
  const first = await anthropicMessages(messages, config);
  const norm = first ? normalizeReflection(parseLooseJson(first)) : null;
  if (norm) return norm;

  const second = await anthropicMessages(
    [...messages, { role: "assistant", content: first.slice(0, 2000) }, { role: "user", content: REPAIR_INSTRUCTION }],
    config
  );
  const norm2 = second ? normalizeReflection(parseLooseJson(second)) : null;
  if (norm2) return norm2;
  throw new Error("Anthropic returned unparseable reflection JSON after retry");
}

export function makeAnthropicProvider(config: LLMConfig): LLMProvider {
  return {
    name: "anthropic",
    generateReflection: (input) => generateReflection(input, config),
    generateJson: (system, user) =>
      anthropicMessages(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        config
      ),
  };
}
