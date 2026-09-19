import { describe, expect, it } from "vitest";
import {
  isNumberColumnHeader,
  normalizeColumnHeader,
} from "./tableColumnHeaders";

describe("tableColumnHeaders", () => {
  it("normalizes whitespace and trailing dots", () => {
    expect(normalizeColumnHeader("  No.  ")).toBe("no");
    expect(normalizeColumnHeader("№  п/п")).toBe("№ п/п");
  });

  it("detects common number headers", () => {
    for (const h of [
      "#",
      "№",
      "N",
      "No",
      "No.",
      "Num",
      "Number",
      "Номер",
      "п/п",
      "№ п/п",
    ]) {
      expect(isNumberColumnHeader(h), h).toBe(true);
    }
  });

  it("rejects ordinary headers", () => {
    for (const h of ["Name", "Title", "Word", "Lemma", "Status", ""]) {
      expect(isNumberColumnHeader(h), h).toBe(false);
    }
  });
});
