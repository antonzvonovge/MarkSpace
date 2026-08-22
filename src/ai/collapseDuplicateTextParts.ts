import { isTextUIPart, type UIMessage } from "ai";

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[\[.*?\]\]/g, " ")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function wikiTargets(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1]!.trim().toLowerCase());
  }
  return out;
}

function shareWikiTarget(a: string, b: string): boolean {
  const aa = wikiTargets(a);
  if (aa.length === 0) return false;
  const bb = new Set(wikiTargets(b));
  return aa.some((t) => bb.has(t));
}

function wordOverlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.length < 6 || wb.length < 6) return 0;
  const setA = new Set(wa.slice(0, 20));
  const setB = new Set(wb.slice(0, 20));
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

/** Gemini often emits the same closing recap as several text parts in one turn. */
export function assistantTextPartsAreDuplicates(a: string, b: string): boolean {
  const wa = words(a).join(" ");
  const wb = words(b).join(" ");
  if (!wa || !wb) return false;
  if (wa === wb) return true;
  if (shareWikiTarget(a, b)) return true;
  return wordOverlap(a, b) >= 0.45;
}

export function collapseDuplicateTextParts(
  parts: UIMessage["parts"],
): UIMessage["parts"] {
  const out: UIMessage["parts"] = [];
  for (const part of parts) {
    if (!isTextUIPart(part)) {
      out.push(part);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && isTextUIPart(prev) && assistantTextPartsAreDuplicates(prev.text, part.text)) {
      if (part.text.trim().length > prev.text.trim().length) {
        out[out.length - 1] = part;
      }
      continue;
    }
    out.push(part);
  }
  return out;
}
