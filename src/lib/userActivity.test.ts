import { beforeEach, describe, expect, it } from "vitest";
import {
  __setUserActivityTransportForTests,
  pingUserActivity,
} from "./userActivity";

describe("pingUserActivity", () => {
  let sent: number;

  beforeEach(() => {
    sent = 0;
    __setUserActivityTransportForTests(() => {
      sent += 1;
    });
  });

  it("sends the first ping immediately", () => {
    pingUserActivity(10_000);
    expect(sent).toBe(1);
  });

  it("coalesces a burst of keystrokes into one call per second", () => {
    for (let i = 0; i < 50; i++) {
      pingUserActivity(10_000 + i * 10);
    }
    expect(sent).toBe(1);
  });

  it("sends again once the window elapses", () => {
    pingUserActivity(10_000);
    pingUserActivity(10_500);
    pingUserActivity(11_000);
    expect(sent).toBe(2);
  });

  it("swallows transport failures", () => {
    __setUserActivityTransportForTests(() => {
      throw new Error("no backend");
    });
    expect(() => pingUserActivity(10_000)).not.toThrow();
  });

  it("keeps ticking across long idle gaps", () => {
    pingUserActivity(0);
    pingUserActivity(60_000);
    pingUserActivity(120_000);
    expect(sent).toBe(3);
  });
});
