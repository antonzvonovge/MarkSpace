import { exportDrawioXmlToSvg } from "./exportSvg";
import { drawioPreviewCacheKey, getOrRenderDrawioSvg } from "./previewCache";

/** Best-effort SVG preview warm for embeds — never on the edit hot path. */
export function warmDrawioPreview(path: string, xml: string): void {
  if (!path.trim() || !xml.trim()) return;
  const key = drawioPreviewCacheKey(path, xml);
  void getOrRenderDrawioSvg(key, () => exportDrawioXmlToSvg(xml)).catch(() => {
    /* preview cache is best-effort */
  });
}
