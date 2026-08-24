import { generateText, type UIMessage } from "ai";
import { unwrapComposerMarkers } from "../lib/chatComposerDom";
import {
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";

const CLASSIFY_TIMEOUT_MS = 1500;

const SKIP_RE =
  /^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|yep|nope|cool|привет|спасибо|ок|ладно|да|нет)[\s!.?…]*$/iu;

const NEED_RE =
  /(?<!\p{L})(why|how come|explain|compare|debug|plan|prove|derive|механизм|почему|разбери|докажи|сравни|пошагов|step by step|trade-?off)(?!\p{L})/iu;

const SYSTEM = `You decide if a chat reply needs extended reasoning (hidden thinking tokens).
Reply with ONLY yes or no.

yes = multi-step analysis, mechanisms, debugging, planning, trade-offs, proofs, ambiguous medical/science "why".
no = greetings, thanks, short facts, lookups, edits, translations, simple yes/no, following an obvious instruction.`;

function messageText(message: UIMessage): string {
  return unwrapComposerMarkers(
    (message.parts ?? [])
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n"),
  ).trim();
}

function lastUserPrompt(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    return messageText(m);
  }
  return "";
}

/** Cheap local gate — skip the worker when the answer is obvious. */
export function heuristicNeedsReasoning(text: string): boolean | null {
  const t = text.trim();
  if (!t) return false;
  if (SKIP_RE.test(t) && t.length < 48) return false;
  if (NEED_RE.test(t)) return true;
  return null;
}

function parseYesNo(raw: string): boolean | null {
  const t = raw.trim().toLowerCase().replace(/[.'"]/g, "");
  if (/^(y|yes|true|1|да)\b/.test(t)) return true;
  if (/^(n|no|false|0|нет)\b/.test(t)) return false;
  return null;
}

export type ShouldUseReasoningParams = {
  messages: UIMessage[];
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
};

export async function shouldUseReasoning(
  params: ShouldUseReasoningParams,
): Promise<boolean> {
  const prompt = lastUserPrompt(params.messages);
  const heuristic = heuristicNeedsReasoning(prompt);
  if (heuristic != null) return heuristic;

  const timeout = AbortSignal.timeout(CLASSIFY_TIMEOUT_MS);
  const signal = params.abortSignal
    ? AbortSignal.any([params.abortSignal, timeout])
    : timeout;

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: SYSTEM,
      prompt: `User message:\n${prompt.slice(0, 2000)}`,
      maxOutputTokens: 8,
      abortSignal: signal,
      temperature: 0,
    });
    return parseYesNo(text);
  };

  try {
    const voted = await runWithModelFallback({
      keys: params.keys,
      modelId: params.modelId,
      fallbackModelId: params.fallbackModelId,
      isEmpty: (v) => v == null,
      run: tryModel,
    });
    if (voted != null) return voted;
  } catch {
    /* timeout / abort / model — default below */
  }

  if (params.abortSignal?.aborted) return false;
  // Ambiguous + worker failed: prefer thinking so hard questions are not skipped.
  return true;
}
