import { describe, expect, it } from "vitest";
import {
  beginGatewayCostCapture,
  createGatewayCostCapturingFetch,
  endGatewayCostCapture,
} from "./gatewayCostCapture";

describe("gatewayCostCapture", () => {
  it("records usage.cost from the final SSE chunk", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      "",
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"cost":0.00125}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const baseFetch = async () =>
      new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });

    const fetch = createGatewayCostCapturingFetch(baseFetch as typeof fetch);
    beginGatewayCostCapture();
    const response = await fetch("https://litellm.example/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    const reader = response.body!.getReader();
    while (!(await reader.read()).done) {
      /* drain */
    }
    expect(endGatewayCostCapture()).toBe(0.00125);
  });
});
