import { describe, expect, it } from "vitest";
import { diagramEngineForLang } from "./renderDiagram";

describe("diagramEngineForLang", () => {
  it("maps fence languages and aliases", () => {
    expect(diagramEngineForLang("mermaid")).toBe("mermaid");
    expect(diagramEngineForLang("plantuml")).toBe("plantuml");
    expect(diagramEngineForLang("puml")).toBe("plantuml");
    expect(diagramEngineForLang("d2")).toBe("d2");
    expect(diagramEngineForLang("dot")).toBe("dot");
    expect(diagramEngineForLang("graphviz")).toBe("dot");
    expect(diagramEngineForLang("GraphViz")).toBe("dot");
    expect(diagramEngineForLang("markmap")).toBe("markmap");
    expect(diagramEngineForLang("js")).toBeNull();
    expect(diagramEngineForLang(undefined)).toBeNull();
  });
});
