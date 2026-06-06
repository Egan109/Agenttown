// Helpers for coaxing JSON out of small-model output. Local models wrap JSON in
// prose, markdown fences, <think> blocks, or trailing commentary. We try a
// sequence of increasingly aggressive extraction strategies before giving up.

/** Strip reasoning/markdown wrappers some models emit (qwen <think>, ``` fences). */
export function stripWrappers(text: string): string {
  let t = text;
  // Remove <think>...</think> reasoning blocks (qwen3 etc.).
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Remove markdown code fences but keep their contents.
  t = t.replace(/```(?:json)?/gi, "");
  return t.trim();
}

/** Find the first balanced {...} object in a string. */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unbalanced — return from first brace to end and let the repairer try.
  return text.slice(start);
}

/** Light syntactic repairs: trailing commas, smart quotes, unquoted keys. */
export function lightRepair(jsonish: string): string {
  let s = jsonish;
  // Normalize smart quotes.
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // Remove trailing commas before } or ].
  s = s.replace(/,\s*([}\]])/g, "$1");
  // Quote bare keys: { key: -> { "key":  (best-effort, avoids values).
  s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*):/g, '$1"$2"$3:');
  // Collapse single quotes used as string delimiters to double quotes
  // (only when they wrap simple tokens, to avoid mangling apostrophes).
  return s;
}

/**
 * Parse text into a JS value using the strategies above. Returns null if nothing
 * usable can be extracted.
 */
export function parseLooseJson(text: string): unknown | null {
  const cleaned = stripWrappers(text);

  // 1. Direct parse.
  try {
    return JSON.parse(cleaned);
  } catch {
    /* keep trying */
  }

  // 2. Extract first object, then parse.
  const extracted = extractFirstJsonObject(cleaned);
  if (extracted) {
    try {
      return JSON.parse(extracted);
    } catch {
      // 3. Light repair, then parse.
      try {
        return JSON.parse(lightRepair(extracted));
      } catch {
        /* give up */
      }
    }
  }
  return null;
}
