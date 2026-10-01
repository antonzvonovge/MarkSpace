import { describe, expect, it } from "vitest";
import {
  cronToSchedule,
  formatSchedule,
  scheduleToCron,
} from "./routineSchedule";

describe("routine schedule", () => {
  it("round-trips the three presets", () => {
    for (const cron of ["0 9 * * *", "0 9 * * 1-5", "0 * * * *"]) {
      const schedule = cronToSchedule(cron);
      expect(schedule).not.toBeNull();
      expect(scheduleToCron(schedule!)).toBe(
        cron === "0 9 * * 1-5" ? "0 9 * * 1,2,3,4,5" : cron,
      );
    }
  });

  it("labels weekdays and daily times", () => {
    expect(formatSchedule("0 9 * * *")).toBe("Daily at 09:00");
    expect(formatSchedule("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(formatSchedule("0 * * * *")).toBe("Hourly");
    expect(formatSchedule("15 18 * * 1,3")).toBe("Mon, Wed at 18:15");
  });

  it("keeps an hourly window inside the same day and on chosen days", () => {
    expect(
      scheduleToCron({
        frequency: "hourly",
        hour: 9,
        minute: 0,
        endHour: 18,
        endMinute: 0,
        days: [1, 2, 3, 4, 5],
      }),
    ).toBe("0 9-18 * * 1,2,3,4,5");
    expect(
      scheduleToCron({
        frequency: "hourly",
        hour: 9,
        minute: 30,
        endHour: 18,
        endMinute: 0,
        days: [],
      }),
    ).toBe("30 9-17 * * *");
    expect(
      scheduleToCron({
        frequency: "hourly",
        hour: 9,
        minute: 0,
        endHour: 18,
        endMinute: 30,
        days: [],
      }),
    ).toBe("0 9-18 * * *");
    expect(formatSchedule("0 9-18 * * 1-5")).toBe("Hourly on weekdays 09:00–18:00");
    expect(formatSchedule("30 9-17 * * *")).toBe("Hourly 09:30–17:30");
    expect(formatSchedule("0 * * * 1-5")).toBe("Hourly on weekdays");
    expect(cronToSchedule("0 9-18 * * 1-5")).toMatchObject({
      frequency: "hourly",
      hour: 9,
      minute: 0,
      endHour: 18,
      endMinute: 0,
      days: [1, 2, 3, 4, 5],
    });
  });
});
