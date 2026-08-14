import { afterEach, describe, expect, it } from "vitest";
import {
  intrinsicSvgSize,
  prepareSvgForClipboard,
} from "./rasterizeSvg";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

function svgFromMarkup(markup: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const svg = host.querySelector("svg");
  if (!svg) throw new Error("expected svg");
  document.body.appendChild(svg);
  return svg;
}

describe("rasterizeSvg", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("reads intrinsic size from data-base-* (ignores zoomed display size)", () => {
    const svg = svgFromMarkup(
      `<svg xmlns="${SVG_NS}" data-base-w="200" data-base-h="100" width="400" height="200" viewBox="0 0 200 100"></svg>`,
    );
    expect(intrinsicSvgSize(svg)).toEqual({ width: 200, height: 100 });
  });

  it("falls back to viewBox when data-base is missing", () => {
    const svg = svgFromMarkup(
      `<svg xmlns="${SVG_NS}" viewBox="0 0 80 40"></svg>`,
    );
    expect(intrinsicSvgSize(svg)).toEqual({ width: 80, height: 40 });
  });

  it("strips mermaid max-width style and sets pixel size for rasterization", () => {
    const svg = svgFromMarkup(
      `<svg xmlns="${SVG_NS}" data-base-w="120" data-base-h="60" style="max-width: 100%; height: auto;" viewBox="0 0 120 60"></svg>`,
    );
    const prepared = prepareSvgForClipboard(svg, 2);
    expect(prepared.getAttribute("style")).toBeNull();
    expect(prepared.getAttribute("width")).toBe("240");
    expect(prepared.getAttribute("height")).toBe("120");
    expect(prepared.getAttribute("xmlns")).toBe(SVG_NS);
  });

  it("replaces HTML foreignObject labels with SVG text", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.dataset.baseW = "200";
    svg.dataset.baseH = "80";
    svg.setAttribute("viewBox", "0 0 200 80");
    const fo = document.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("x", "10");
    fo.setAttribute("y", "20");
    fo.setAttribute("width", "80");
    fo.setAttribute("height", "24");
    const label = document.createElementNS(XHTML_NS, "div");
    label.textContent = "Start";
    fo.appendChild(label);
    svg.appendChild(fo);
    document.body.appendChild(svg);

    const prepared = prepareSvgForClipboard(svg, 1);
    expect(prepared.querySelector("foreignObject")).toBeNull();
    const text = prepared.querySelector("text");
    expect(text?.textContent).toBe("Start");
    expect(text?.getAttribute("text-anchor")).toBe("middle");
  });
});
