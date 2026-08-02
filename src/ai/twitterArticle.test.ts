import { describe, expect, it } from "vitest";
import { parseTwitterStatusUrl } from "./twitterArticle";

describe("parseTwitterStatusUrl", () => {
  it("parses x.com and twitter.com status URLs", () => {
    expect(
      parseTwitterStatusUrl(
        "https://x.com/beamnxw/status/2081022966645535079?s=20",
      ),
    ).toEqual({ screenName: "beamnxw", statusId: "2081022966645535079" });
    expect(
      parseTwitterStatusUrl(
        "https://twitter.com/foo/status/1234567890",
      ),
    ).toEqual({ screenName: "foo", statusId: "1234567890" });
  });

  it("rejects non-status URLs", () => {
    expect(parseTwitterStatusUrl("https://x.com/beamnxw")).toBeNull();
    expect(parseTwitterStatusUrl("https://example.com/status/1")).toBeNull();
  });
});
