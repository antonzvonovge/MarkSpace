import { beforeEach, describe, expect, it } from "vitest";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { DEFAULT_AI_SETTINGS } from "./types";
import {
  buildWebTools,
  mergeImageUrlsIntoMarkdown,
  normalizeFirecrawlMarkdown,
  resolveWebFetchProvider,
} from "./webTools";

describe("resolveWebFetchProvider", () => {
  beforeEach(() => {
    useAiSettingsStore.setState({
      settings: { ...DEFAULT_AI_SETTINGS },
      hydrated: true,
    });
  });

  it("defaults to jina with no keys", () => {
    expect(resolveWebFetchProvider()).toBe("jina");
  });

  it("uses tavily when configured (ignores firecrawl for ordinary fetch)", () => {
    useAiSettingsStore.setState({
      settings: {
        ...DEFAULT_AI_SETTINGS,
        firecrawlApiKey: "fc-test",
        tavilyApiKey: "tvly-test",
      },
    });
    expect(resolveWebFetchProvider()).toBe("tavily");
  });

  it("honors an explicit provider", () => {
    useAiSettingsStore.setState({
      settings: {
        ...DEFAULT_AI_SETTINGS,
        tavilyApiKey: "tvly-test",
      },
    });
    expect(resolveWebFetchProvider("jina")).toBe("jina");
  });
});

describe("buildWebTools", () => {
  it("exposes scrape_url separately from fetch_url", () => {
    const tools = buildWebTools();
    expect(tools).toHaveProperty("fetch_url");
    expect(tools).toHaveProperty("scrape_url");
    expect(tools).toHaveProperty("web_search");
  });
});

describe("normalizeFirecrawlMarkdown", () => {
  it("unescapes over-escaped punctuation outside code", () => {
    const raw = [
      "URL: [https://x\\.com/a](https://x\\.com/a)",
      "Posted: 2026\\-07\\-25T14:25:13\\.000Z",
      "`keep\\.this`",
      "```",
      "code\\-fence",
      "```",
      "A &amp; B",
    ].join("\n");
    const out = normalizeFirecrawlMarkdown(raw);
    expect(out).toContain("https://x.com/a");
    expect(out).toContain("2026-07-25T14:25:13.000Z");
    expect(out).toContain("`keep\\.this`");
    expect(out).toContain("code\\-fence");
    expect(out).toContain("A & B");
  });
});

describe("mergeImageUrlsIntoMarkdown", () => {
  it("appends missing image URLs", () => {
    const md = "Hello\n\n![a](https://cdn.example.com/a.png)";
    const out = mergeImageUrlsIntoMarkdown(md, [
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.jpg",
    ]);
    expect(out).toContain("![a](https://cdn.example.com/a.png)");
    expect(out).toContain("## Images");
    expect(out).toContain("![image 1](https://cdn.example.com/b.jpg)");
    expect(out).not.toMatch(/image 2/);
  });
});
