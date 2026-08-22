import { afterEach, describe, expect, it } from "vitest";
import { createToolWait } from "./toolWait";

describe("createToolWait", () => {
  const wait = createToolWait<string>("test");
  afterEach(() => wait.cancelAll());

  it("accepts an answer before wait()", async () => {
    expect(wait.resolve("c1", "folder")).toBe(true);
    await expect(wait.wait("c1")).resolves.toBe("folder");
    expect(wait.has("c1")).toBe(false);
  });

  it("resolves a single waiter even if ids differ", async () => {
    const a = wait.wait("sdk-id");
    wait.resolve("ui-id", "folder");
    await expect(a).resolves.toBe("folder");
  });

  it("shares one waiter for the same id", async () => {
    const a = wait.wait("c2");
    const b = wait.wait("c2");
    wait.resolve("c2", "ok");
    await expect(a).resolves.toBe("ok");
    await expect(b).resolves.toBe("ok");
  });
});
