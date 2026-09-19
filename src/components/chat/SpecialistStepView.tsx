import { memo, useMemo } from "react";
import type { SpecialistStep } from "../../ai/specialists";

const PREVIEW_CAP = 720;
const SUMMARY_CAP = 120;

type Field = {
  label: string;
  value: string;
  multiline?: boolean;
};

function oneLine(text: string, max = SUMMARY_CAP): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function clip(text: string, max = PREVIEW_CAP): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…truncated (${text.length.toLocaleString()} chars)`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Pull a JSON string field from slimIo-truncated payload text. */
function extractJsonStringField(raw: string, key: string): string {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = re.exec(raw);
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

function extractJsonNumberField(raw: string, key: string): number | null {
  const re = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const m = re.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractJsonBoolField(raw: string, key: string): boolean | null {
  const re = new RegExp(`"${key}"\\s*:\\s*(true|false)`);
  const m = re.exec(raw);
  if (!m) return null;
  return m[1] === "true";
}

type Coerced = {
  record: Record<string, unknown> | null;
  truncatedBlob: boolean;
  blob: string;
};

function coercePayload(value: unknown): Coerced {
  if (value === undefined || value === null) {
    return { record: null, truncatedBlob: false, blob: "" };
  }
  const rec = asRecord(value);
  if (rec) return { record: rec, truncatedBlob: false, blob: "" };
  if (typeof value === "string") {
    const truncated = /…\[\+\d+\]$/.test(value) || value.includes("…[+");
    if (!truncated) {
      try {
        const parsed = JSON.parse(value) as unknown;
        const parsedRec = asRecord(parsed);
        if (parsedRec) {
          return { record: parsedRec, truncatedBlob: false, blob: "" };
        }
      } catch {
        /* plain text */
      }
      return { record: null, truncatedBlob: false, blob: value };
    }
    return { record: null, truncatedBlob: true, blob: value };
  }
  try {
    return {
      record: null,
      truncatedBlob: false,
      blob: JSON.stringify(value, null, 2),
    };
  } catch {
    return { record: null, truncatedBlob: false, blob: String(value) };
  }
}

function pathFrom(coerced: Coerced): string {
  const fromRec = str(coerced.record?.path) || str(coerced.record?.note_path);
  if (fromRec) return fromRec;
  if (coerced.blob) {
    return (
      extractJsonStringField(coerced.blob, "path") ||
      extractJsonStringField(coerced.blob, "note_path")
    );
  }
  return "";
}

function pushField(fields: Field[], label: string, value: string, multiline = false) {
  if (!value) return;
  fields.push({ label, value: multiline ? clip(value) : oneLine(value, 200), multiline });
}

function fieldsForReadOutput(coerced: Coerced): Field[] {
  const fields: Field[] = [];
  const path = pathFrom(coerced);
  pushField(fields, "Path", path);

  if (coerced.record) {
    const lineCount = num(coerced.record.line_count);
    const pageCount = num(coerced.record.page_count);
    const truncated = bool(coerced.record.truncated);
    const kind = str(coerced.record.kind);
    const note = str(coerced.record.note);
    const start = num(coerced.record.start_line) ?? num(coerced.record.start_page);
    const end = num(coerced.record.end_line) ?? num(coerced.record.end_page);
    if (kind) pushField(fields, "Kind", kind);
    if (lineCount != null) pushField(fields, "Lines", String(lineCount));
    if (pageCount != null) pushField(fields, "Pages", String(pageCount));
    if (start != null && end != null) {
      pushField(fields, "Range", `${start}–${end}`);
    }
    if (truncated) pushField(fields, "Note", "Content truncated");
    if (note) pushField(fields, "Note", note);
    // Skip dumping full note body — it is what made the track unreadable.
    return fields;
  }

  if (coerced.truncatedBlob) {
    const lines = extractJsonNumberField(coerced.blob, "line_count");
    const pages = extractJsonNumberField(coerced.blob, "page_count");
    const truncated = extractJsonBoolField(coerced.blob, "truncated");
    if (lines != null) pushField(fields, "Lines", String(lines));
    if (pages != null) pushField(fields, "Pages", String(pages));
    if (truncated) pushField(fields, "Note", "Content truncated");
    pushField(fields, "Result", "Large payload omitted");
    return fields;
  }

  if (coerced.blob) pushField(fields, "Result", coerced.blob, true);
  return fields;
}

function fieldsForGeneric(
  label: string,
  coerced: Coerced,
  preferKeys: string[],
  omitKeys: Set<string>,
): Field[] {
  const fields: Field[] = [];
  if (coerced.record) {
    for (const key of preferKeys) {
      const v = coerced.record[key];
      if (typeof v === "string" && v) {
        const multiline =
          key.includes("content") ||
          key.includes("string") ||
          key.includes("query") ||
          key === "body" ||
          key === "text" ||
          v.includes("\n") ||
          v.length > 80;
        pushField(fields, labelForKey(key), v, multiline);
      } else if (typeof v === "number" || typeof v === "boolean") {
        pushField(fields, labelForKey(key), String(v));
      }
    }
    for (const [key, v] of Object.entries(coerced.record)) {
      if (omitKeys.has(key) || preferKeys.includes(key)) continue;
      if (typeof v === "string" && v) {
        const multiline = v.includes("\n") || v.length > 80;
        // Skip huge opaque blobs in generic fallback
        if (v.length > 4_000 && (key === "content" || key === "html")) {
          pushField(fields, labelForKey(key), `(${v.length.toLocaleString()} chars omitted)`);
        } else {
          pushField(fields, labelForKey(key), v, multiline);
        }
      } else if (typeof v === "number" || typeof v === "boolean") {
        pushField(fields, labelForKey(key), String(v));
      } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        pushField(fields, labelForKey(key), v.join(", "));
      }
    }
    return fields;
  }
  if (coerced.truncatedBlob) {
    const path = pathFrom(coerced);
    pushField(fields, "Path", path);
    pushField(fields, label, "Large payload omitted");
    return fields;
  }
  if (coerced.blob) pushField(fields, label, coerced.blob, true);
  return fields;
}

function labelForKey(key: string): string {
  const map: Record<string, string> = {
    path: "Path",
    note_path: "Path",
    old_string: "Remove",
    new_string: "Add",
    replace_all: "Replace all",
    content: "Content",
    query: "Query",
    url: "URL",
    folder: "Folder",
    cwd: "cwd",
    command: "Command",
    ok: "OK",
    error: "Error",
    replacements: "Replacements",
    occurrences: "Matches",
    truncated: "Truncated",
    line_count: "Lines",
    page_count: "Pages",
    title: "Title",
    summary: "Summary",
  };
  if (map[key]) return map[key];
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildStepFields(step: SpecialistStep): {
  summary: string;
  fields: Field[];
} {
  const input = coercePayload(step.input);
  const output = coercePayload(step.output);
  const tool = step.toolName;
  const fields: Field[] = [];

  const inputPath =
    pathFrom(input) ||
    str(input.record?.folder) ||
    str(input.record?.url) ||
    str(input.record?.query);

  let summary = "";

  switch (tool) {
    case "read_note":
    case "read_file": {
      summary = pathFrom(input) || pathFrom(output) || "note";
      pushField(fields, "Path", pathFrom(input) || pathFrom(output));
      const start = num(input.record?.start_line);
      const end = num(input.record?.end_line);
      if (start != null || end != null) {
        pushField(
          fields,
          "Lines",
          `${start ?? "…"}–${end ?? "…"}`,
        );
      }
      const outFields = fieldsForReadOutput(output);
      const inputHadPath = Boolean(pathFrom(input));
      fields.push(
        ...outFields.filter((f) => !(inputHadPath && f.label === "Path")),
      );
      break;
    }
    case "edit_note": {
      summary = pathFrom(input) || pathFrom(output) || "edit";
      pushField(fields, "Path", pathFrom(input) || pathFrom(output));
      pushField(fields, "Remove", str(input.record?.old_string), true);
      pushField(fields, "Add", str(input.record?.new_string), true);
      if (bool(input.record?.replace_all)) {
        pushField(fields, "Replace all", "yes");
      }
      if (output.record) {
        if (bool(output.record.ok) === true) {
          const n = num(output.record.replacements);
          pushField(
            fields,
            "Result",
            n != null ? `${n} replacement${n === 1 ? "" : "s"}` : "ok",
          );
        } else if (str(output.record.error)) {
          pushField(fields, "Error", str(output.record.error), true);
        } else {
          fields.push(
            ...fieldsForGeneric("Result", output, ["ok", "replacements", "error"], new Set(["path"])),
          );
        }
      } else if (output.blob || output.truncatedBlob) {
        fields.push(...fieldsForGeneric("Result", output, [], new Set()));
      }
      break;
    }
    case "write_note":
    case "create_note": {
      summary = pathFrom(input) || pathFrom(output) || tool;
      pushField(fields, "Path", pathFrom(input) || pathFrom(output));
      if (tool === "write_note") {
        pushField(fields, "Content", str(input.record?.content), true);
      }
      if (output.record) {
        if (bool(output.record.ok) === false || str(output.record.error)) {
          pushField(fields, "Error", str(output.record.error) || "failed", true);
        } else {
          pushField(fields, "Result", "ok");
        }
      }
      break;
    }
    case "search_notes":
    case "semantic_search":
    case "web_search": {
      const q = str(input.record?.query) || str(input.record?.q);
      summary = oneLine(q, 80) || tool;
      pushField(fields, "Query", q, true);
      fields.push(
        ...fieldsForGeneric(
          "Result",
          output,
          ["results", "hits", "count", "error"],
          new Set(["query", "q"]),
        ),
      );
      break;
    }
    case "list_folder":
    case "list_notes": {
      summary =
        str(input.record?.path) ||
        str(input.record?.folder) ||
        pathFrom(input) ||
        tool;
      pushField(fields, "Folder", summary);
      fields.push(
        ...fieldsForGeneric("Result", output, ["entries", "notes", "count"], new Set(["path", "folder"])),
      );
      break;
    }
    case "fetch_url":
    case "scrape_url":
    case "clip_article": {
      const url = str(input.record?.url) || extractJsonStringField(input.blob, "url");
      summary = oneLine(url, 80) || tool;
      pushField(fields, "URL", url);
      fields.push(
        ...fieldsForGeneric(
          "Result",
          output,
          ["title", "path", "note_path", "truncated", "error"],
          new Set(["url", "content", "html", "markdown"]),
        ),
      );
      break;
    }
    case "run_terminal": {
      const cmd = str(input.record?.command);
      summary = oneLine(cmd, 80) || "terminal";
      pushField(fields, "Command", cmd, true);
      pushField(fields, "cwd", str(input.record?.cwd));
      pushField(fields, "stdout", str(output.record?.stdout), true);
      pushField(fields, "stderr", str(output.record?.stderr), true);
      if (str(output.record?.error)) {
        pushField(fields, "Error", str(output.record?.error), true);
      }
      break;
    }
    default: {
      summary =
        oneLine(inputPath, 80) ||
        oneLine(str(input.record?.title), 80) ||
        tool;
      fields.push(
        ...fieldsForGeneric(
          "Input",
          input,
          ["path", "note_path", "query", "url", "title", "folder", "command"],
          new Set(),
        ),
      );
      // Avoid duplicating content dumps for unknown read-like tools
      const outOmit = new Set(["content", "html", "markdown", "xml"]);
      if (output.record || output.blob || output.truncatedBlob) {
        fields.push(
          ...fieldsForGeneric(
            "Result",
            output,
            ["ok", "path", "error", "summary", "title"],
            outOmit,
          ),
        );
      }
      break;
    }
  }

  if (step.error) {
    pushField(fields, "Error", step.error, true);
  }

  // Deduplicate identical Path fields
  const seen = new Set<string>();
  const deduped = fields.filter((f) => {
    const key = `${f.label}\0${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { summary: oneLine(summary, SUMMARY_CAP) || tool, fields: deduped };
}

type Props = {
  step: SpecialistStep;
};

function SpecialistStepViewInner({ step }: Props) {
  const { summary, fields } = useMemo(() => buildStepFields(step), [step]);

  return (
    <li className="chat-specialist-card-step">
      <div className="chat-specialist-card-step-name">
        <span className="chat-specialist-card-step-tool">{step.toolName}</span>
        {summary && summary !== step.toolName ? (
          <span className="chat-specialist-card-step-summary" title={summary}>
            {summary}
          </span>
        ) : null}
        {step.error ? (
          <span className="chat-specialist-card-step-err">error</span>
        ) : null}
      </div>
      {fields.length > 0 ? (
        <div className="chat-specialist-card-step-fields">
          {fields.map((f, i) => (
            <div key={`${f.label}-${i}`} className="chat-specialist-card-step-field">
              <div className="chat-specialist-card-step-label">{f.label}</div>
              {f.multiline ? (
                <pre>{f.value}</pre>
              ) : (
                <div className="chat-specialist-card-step-value">{f.value}</div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export const SpecialistStepView = memo(SpecialistStepViewInner);
