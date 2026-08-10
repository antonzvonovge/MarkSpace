/** Minimal empty mxfile for new diagrams. */
export const EMPTY_DRAWIO_XML = `<mxfile host="MarkSpace" agent="MarkSpace" version="28.2.5" type="device">
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

export const DEFAULT_DRAWIO_PREVIEW_WIDTH = 480;

export function buildDrawioEmbedUrl(opts: {
  dark?: boolean;
  lightbox?: boolean;
  /** Shape libraries UI; default on for the interactive editor, off for export. */
  libraries?: boolean;
}): string {
  const params = new URLSearchParams({
    embed: "1",
    proto: "json",
    spin: "1",
    libraries: opts.libraries === false ? "0" : "1",
    offline: "1",
    saveAndExit: "0",
    noSaveBtn: "1",
    noExitBtn: "1",
  });
  if (opts.dark) params.set("ui", "dark");
  if (opts.lightbox) {
    params.set("lightbox", "1");
    params.set("layers", "1");
    params.set("nav", "1");
  }
  return `/drawio/index.html?${params.toString()}`;
}

/** Simple non-crypto hash for cache keys. */
export function hashXml(xml: string): string {
  let h = 2166136261;
  for (let i = 0; i < xml.length; i++) {
    h ^= xml.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
