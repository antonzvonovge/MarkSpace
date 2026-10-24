import { describe, expect, it } from "vitest";
import {
  classifyDashboardHref,
  DASHBOARD_NOTE_SCHEME,
  dirnameFs,
  joinPathSegments,
  parseFileUrl,
} from "./resolveDashboardHref";

describe("dirnameFs", () => {
  it("returns parent for posix paths", () => {
    expect(dirnameFs("/home/jobs/out/report.md")).toBe("/home/jobs/out");
    expect(dirnameFs("/report.md")).toBe("/");
  });

  it("keeps windows drive root", () => {
    expect(dirnameFs("C:/Users/a/b.md")).toBe("C:/Users/a");
    expect(dirnameFs("C:/b.md")).toBe("C:/");
  });
});

describe("joinPathSegments", () => {
  it("joins relative segments onto an absolute dir", () => {
    expect(joinPathSegments("/home/jobs/out", "sibling.md")).toBe(
      "/home/jobs/out/sibling.md",
    );
    expect(joinPathSegments("/home/jobs/out", "../other.md")).toBe(
      "/home/jobs/other.md",
    );
  });

  it("joins vault-relative dirs", () => {
    expect(joinPathSegments("Notes/day", "./x.md")).toBe("Notes/day/x.md");
    expect(joinPathSegments("Notes/day", "../x.md")).toBe("Notes/x.md");
  });
});

describe("parseFileUrl", () => {
  it("parses posix file urls", () => {
    expect(parseFileUrl("file:///home/jobs/a.md")).toBe("/home/jobs/a.md");
  });

  it("parses windows file urls", () => {
    expect(parseFileUrl("file:///C:/Users/a/b.md")).toBe("C:/Users/a/b.md");
  });
});

describe("classifyDashboardHref", () => {
  const absSource = "/home/jobs/out/report.md";

  it("opens absolute markdown links", () => {
    expect(
      classifyDashboardHref("/tmp/other.md", absSource),
    ).toEqual({ action: "open", path: "/tmp/other.md" });
  });

  it("resolves relative links against absolute source", () => {
    expect(classifyDashboardHref("./detail.md", absSource)).toEqual({
      action: "open",
      path: "/home/jobs/out/detail.md",
    });
    expect(classifyDashboardHref("detail", absSource)).toEqual({
      action: "open",
      path: "/home/jobs/out/detail.md",
    });
  });

  it("parses file: urls", () => {
    expect(
      classifyDashboardHref("file:///home/jobs/out/x.md", absSource),
    ).toEqual({ action: "open", path: "/home/jobs/out/x.md" });
  });

  it("sends http and mailto to the browser", () => {
    expect(classifyDashboardHref("https://example.com", absSource)).toEqual({
      action: "browser",
      url: "https://example.com",
    });
    expect(classifyDashboardHref("mailto:a@b.c", absSource)).toEqual({
      action: "browser",
      url: "mailto:a@b.c",
    });
  });

  it("treats wiki scheme and markspace-note as wiki targets", () => {
    expect(
      classifyDashboardHref(
        `${DASHBOARD_NOTE_SCHEME}${encodeURIComponent("Notes/Foo")}`,
        absSource,
      ),
    ).toEqual({ action: "wiki", target: "Notes/Foo" });
    expect(classifyDashboardHref("wiki:Notes%2FBar", absSource)).toEqual({
      action: "wiki",
      target: "Notes/Bar",
    });
  });

  it("resolves relative links against vault source as wiki", () => {
    expect(classifyDashboardHref("./sib.md", "Notes/day/a.md")).toEqual({
      action: "wiki",
      target: "Notes/day/sib",
    });
  });

  it("ignores hash-only and empty hrefs", () => {
    expect(classifyDashboardHref("#section", absSource)).toEqual({
      action: "none",
    });
    expect(classifyDashboardHref("  ", absSource)).toEqual({ action: "none" });
  });
});
