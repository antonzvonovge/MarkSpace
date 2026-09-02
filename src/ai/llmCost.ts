import type { StepResult, ToolSet } from "ai";

const COST_HEADER_SUFFIXES = ["-response-cost"] as const;

const COST_FIELD_KEYS = [
  "cost",
  "response_cost",
  "total_cost",
  "totalCost",
] as const;

export function parseUsdCost(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number.parseFloat(trimmed);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function costFromRecord(record: Record<string, unknown>): number | null {
  for (const key of COST_FIELD_KEYS) {
    const parsed = parseUsdCost(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function costFromHeaders(
  headers: Record<string, string> | undefined,
): number | null {
  if (!headers) return null;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      lower === "x-litellm-response-cost" ||
      lower === "x-response-cost" ||
      COST_HEADER_SUFFIXES.some((suffix) => lower.endsWith(suffix))
    ) {
      const parsed = parseUsdCost(value);
      if (parsed != null && parsed > 0) return parsed;
    }
  }
  return null;
}

function costFromBody(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const direct = costFromRecord(record);
  if (direct != null) return direct;
  const usage = record.usage;
  if (usage && typeof usage === "object") {
    return costFromRecord(usage as Record<string, unknown>);
  }
  return null;
}

type CostStep = Pick<
  StepResult<ToolSet>,
  "response" | "usage" | "providerMetadata"
>;

/** USD cost for one model step, when the provider or gateway reports it. */
export function extractStepCostUsd(step: CostStep): number | null {
  const fromHeaders = costFromHeaders(step.response?.headers);
  if (fromHeaders != null) return fromHeaders;

  const fromBody = costFromBody(step.response?.body);
  if (fromBody != null) return fromBody;

  const raw = step.usage?.raw;
  if (raw && typeof raw === "object") {
    const fromRaw = costFromRecord(raw as Record<string, unknown>);
    if (fromRaw != null) return fromRaw;
  }

  const metadata = step.providerMetadata;
  if (metadata && typeof metadata === "object") {
    for (const vendorMeta of Object.values(metadata)) {
      if (vendorMeta && typeof vendorMeta === "object") {
        const fromVendor = costFromRecord(vendorMeta as Record<string, unknown>);
        if (fromVendor != null) return fromVendor;
      }
    }
  }

  return null;
}

export function sumStepCostsUsd(steps: readonly CostStep[]): number | null {
  let total = 0;
  let seen = false;
  for (const step of steps) {
    const cost = extractStepCostUsd(step);
    if (cost == null) continue;
    total += cost;
    seen = true;
  }
  return seen ? total : null;
}

export function formatChatCostUsd(totalUsd: number): string {
  return `${totalUsd.toFixed(4)} $`;
}
