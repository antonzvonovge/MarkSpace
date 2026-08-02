import guide from "../../docs/mddict-format.md?raw";

export const MDDICT_FORMAT_GUIDE = guide;

const CORE_START = "<!-- core-rules:start -->";
const CORE_END = "<!-- core-rules:end -->";

/** Core bullets from docs/mddict-format.md for the system prompt. */
export function mddictCoreRules(): string[] {
  const start = MDDICT_FORMAT_GUIDE.indexOf(CORE_START);
  const end = MDDICT_FORMAT_GUIDE.indexOf(CORE_END);
  if (start < 0 || end < 0 || end <= start) return [];
  const block = MDDICT_FORMAT_GUIDE.slice(start + CORE_START.length, end);
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}
