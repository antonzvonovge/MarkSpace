import { describe, expect, it } from "vitest";
import {
  buildTagGraph,
  buildWikiLinkGraph,
  noteLabel,
  noteNodeId,
  tagNodeId,
} from "./tagGraph";

describe("buildTagGraph", () => {
  const sample = [
    { path: "Projects/Alpha.md", tags: ["work", "active"] },
    { path: "Projects/Beta.md", tags: ["Work", "idea"] },
    { path: "Journal/Day1.md", tags: ["personal"] },
  ];

  it("builds a bipartite note↔tag graph with canonical tag casing", () => {
    const g = buildTagGraph(sample);
    const tags = g.nodes.filter((n) => n.kind === "tag").map((n) => n.label);
    const notes = g.nodes.filter((n) => n.kind === "note").map((n) => n.key);

    expect(tags).toEqual(["active", "idea", "personal", "work"]);
    // Notes are sorted by display label (stem), not path.
    expect(notes).toEqual([
      "Projects/Alpha.md",
      "Projects/Beta.md",
      "Journal/Day1.md",
    ]);
    expect(g.edges).toHaveLength(5);
    expect(
      g.edges.some(
        (e) =>
          e.source === noteNodeId("Projects/Beta.md") &&
          e.target === tagNodeId("work"),
      ),
    ).toBe(true);
    expect(g.nodes.find((n) => n.id === tagNodeId("work"))?.degree).toBe(2);
  });

  it("includes untagged notes when requested", () => {
    const g = buildTagGraph(sample, {
      showUntagged: true,
      allNotePaths: [
        "Projects/Alpha.md",
        "Projects/Beta.md",
        "Journal/Day1.md",
        "Scratch/Empty.md",
      ],
    });
    const orphan = g.nodes.find((n) => n.key === "Scratch/Empty.md");
    expect(orphan).toMatchObject({
      kind: "note",
      untagged: true,
      degree: 0,
      label: "Empty",
    });
  });

  it("builds tags-only co-occurrence edges", () => {
    const g = buildTagGraph(sample, { tagsOnly: true });
    expect(g.nodes.every((n) => n.kind === "tag")).toBe(true);
    // Alpha: work–active; Beta: work–idea
    expect(g.edges).toHaveLength(2);
    expect(
      g.edges.some(
        (e) =>
          e.source === tagNodeId("active") && e.target === tagNodeId("work"),
      ),
    ).toBe(true);
  });

  it("scopes to a tag root at depth 1", () => {
    const g = buildTagGraph(sample, { root: "work", depth: 1 });
    const noteKeys = g.nodes
      .filter((n) => n.kind === "note")
      .map((n) => n.key)
      .sort();
    const tagKeys = g.nodes
      .filter((n) => n.kind === "tag")
      .map((n) => n.key)
      .sort();
    expect(noteKeys).toEqual(["Projects/Alpha.md", "Projects/Beta.md"]);
    // depth 1 from tag: notes + the seed tag only (their other tags need depth 2)
    expect(tagKeys).toEqual(["work"]);
  });

  it("scopes to a note root and expands tags at depth 1", () => {
    const g = buildTagGraph(sample, {
      root: "Projects/Alpha.md",
      depth: 1,
    });
    expect(g.nodes.filter((n) => n.kind === "note").map((n) => n.key)).toEqual([
      "Projects/Alpha.md",
    ]);
    expect(
      g.nodes
        .filter((n) => n.kind === "tag")
        .map((n) => n.key)
        .sort(),
    ).toEqual(["active", "work"]);
  });

  it("returns empty graph for empty input", () => {
    expect(buildTagGraph([])).toEqual({ nodes: [], edges: [] });
  });

  it("includes tagged PDFs alongside markdown notes", () => {
    const g = buildTagGraph([
      ...sample,
      { path: "Docs/spec.pdf", tags: ["work"] },
    ]);
    expect(g.nodes.some((n) => n.key === "Docs/spec.pdf")).toBe(true);
    expect(g.nodes.find((n) => n.key === "Docs/spec.pdf")?.label).toBe("spec");
    expect(g.nodes.find((n) => n.id === tagNodeId("work"))?.degree).toBe(3);
  });

  it("includes untagged PDFs when requested", () => {
    const g = buildTagGraph(sample, {
      showUntagged: true,
      allNotePaths: ["Scratch/Empty.md", "Docs/scan.pdf"],
    });
    expect(g.nodes.find((n) => n.key === "Docs/scan.pdf")).toMatchObject({
      kind: "note",
      untagged: true,
      label: "scan",
    });
  });
});

describe("buildWikiLinkGraph", () => {
  it("builds note–note wiki-link edges", () => {
    const g = buildWikiLinkGraph([
      { path: "A.md", targets: ["B.md"] },
      { path: "B.md", targets: ["A.md", "C.md"] },
    ]);
    expect(g.nodes.every((n) => n.kind === "note")).toBe(true);
    expect(g.edges).toHaveLength(2);
    expect(
      g.edges.some(
        (e) =>
          e.source === noteNodeId("A.md") && e.target === noteNodeId("B.md"),
      ),
    ).toBe(true);
  });
});

describe("noteLabel", () => {
  it("uses the parent folder name for hidden folder notes", () => {
    expect(noteLabel("English/IELTS/.folder.md")).toBe("IELTS");
    expect(noteLabel("Projects/.folder.md")).toBe("Projects");
    expect(noteLabel(".folder.md")).toBe("Vault");
  });
});
