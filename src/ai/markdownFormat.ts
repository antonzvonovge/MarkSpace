import guide from "../../docs/markdown-format.md?raw";

export const MARKDOWN_FORMAT_GUIDE = guide;

const CORE_START = "<!-- core-rules:start -->";
const CORE_END = "<!-- core-rules:end -->";

/**
 * Extract bullet lines from the core-rules block in docs/markdown-format.md
 * for injection into the agent system prompt.
 */
export function markdownCoreRules(): string[] {
  const start = MARKDOWN_FORMAT_GUIDE.indexOf(CORE_START);
  const end = MARKDOWN_FORMAT_GUIDE.indexOf(CORE_END);
  if (start < 0 || end < 0 || end <= start) {
    return [];
  }
  const block = MARKDOWN_FORMAT_GUIDE.slice(start + CORE_START.length, end);
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}
