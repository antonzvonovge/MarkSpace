import guide from "../../docs/mdhabit-format.md?raw";

export const MDHABIT_FORMAT_GUIDE = guide;

const CORE_START = "<!-- core-rules:start -->";
const CORE_END = "<!-- core-rules:end -->";

/** Core bullets from docs/mdhabit-format.md for the system prompt. */
export function mdhabitCoreRules(): string[] {
  const start = MDHABIT_FORMAT_GUIDE.indexOf(CORE_START);
  const end = MDHABIT_FORMAT_GUIDE.indexOf(CORE_END);
  if (start < 0 || end < 0 || end <= start) return [];
  const block = MDHABIT_FORMAT_GUIDE.slice(start + CORE_START.length, end);
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}
