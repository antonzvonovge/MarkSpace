import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetSpecialistLiveForTests,
  _resetWriteLocksForTests,
  _testWriteLock,
} from "./specialists";

describe("specialist write path mutex", () => {
  beforeEach(() => {
    _resetSpecialistLiveForTests();
    _resetWriteLocksForTests();
  });

  it("allows concurrent research-like writers on disjoint paths", async () => {
    const releaseA = await _testWriteLock.acquire("a", ["Notes/A.md"]);
    const releaseB = await _testWriteLock.acquire("b", ["Notes/B.md"]);
    expect(_testWriteLock.holders()).toHaveLength(2);
    releaseA();
    releaseB();
    expect(_testWriteLock.holders()).toHaveLength(0);
  });

  it("serializes overlapping write paths", async () => {
    const releaseA = await _testWriteLock.acquire("a", ["Project/x.md"]);
    let unlocked = false;
    const pending = _testWriteLock.acquire("b", ["Project/x.md"]).then((rel) => {
      unlocked = true;
      return rel;
    });
    await Promise.resolve();
    expect(unlocked).toBe(false);
    releaseA();
    const releaseB = await pending;
    expect(unlocked).toBe(true);
    releaseB();
  });
});
