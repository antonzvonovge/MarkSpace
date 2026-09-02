import type { FetchFunction } from "@ai-sdk/provider-utils";
import { parseUsdCost } from "./llmCost";

type CaptureCtx = { costs: number[] };

const captureStack: CaptureCtx[] = [];

/** Begin capturing gateway-reported cost for the next LLM HTTP call(s). */
export function beginGatewayCostCapture(): void {
  captureStack.push({ costs: [] });
}

/** End capture and return USD reported in the latest usage chunk(s), if any. */
export function endGatewayCostCapture(): number | null {
  const ctx = captureStack.pop();
  if (!ctx?.costs.length) return null;
  return ctx.costs.reduce((sum, cost) => sum + cost, 0);
}

function pushCapturedCost(cost: number): void {
  const ctx = captureStack[captureStack.length - 1];
  if (!ctx || cost <= 0) return;
  ctx.costs.push(cost);
}

function extractUsageCostFromJson(text: string): number | null {
  try {
    const json = JSON.parse(text) as { usage?: Record<string, unknown> };
    if (!json.usage || typeof json.usage !== "object") return null;
    return parseUsdCost(json.usage.cost);
  } catch {
    return null;
  }
}

function wrapStreamingBody(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lastCost: number | null = null;

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trimEnd();
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data && data !== "[DONE]") {
              const cost = extractUsageCostFromJson(data);
              if (cost != null) lastCost = cost;
            }
          }
          newline = buffer.indexOf("\n");
        }
      },
      flush() {
        if (lastCost != null) pushCapturedCost(lastCost);
      },
    }),
  );
}

function isChatCompletionsUrl(url: string): boolean {
  return /\/chat\/completions\/?(\?|$)/.test(url);
}

/** Fetch wrapper that records `usage.cost` from OpenAI-compatible gateway streams. */
export function createGatewayCostCapturingFetch(
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): FetchFunction {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (!captureStack.length) return response;

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (init?.method?.toUpperCase() !== "POST" || !isChatCompletionsUrl(url)) {
      return response;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream") && response.body) {
      return new Response(wrapStreamingBody(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    if (contentType.includes("application/json")) {
      try {
        const text = await response.clone().text();
        const cost = extractUsageCostFromJson(text);
        if (cost != null) pushCapturedCost(cost);
      } catch {
        /* ignore parse failures */
      }
    }

    return response;
  };
}

const gatewayFetch = createGatewayCostCapturingFetch();

export function gatewayLlmFetch(): FetchFunction {
  return gatewayFetch;
}
