import { expect, test } from "bun:test";
import { nextServiceDate, salesOpenFor } from "./next-trip";

const today = "2026-11-26";

test("next day after the last trip", () => {
  expect(nextServiceDate("2026-11-27", null, today)).toBe("2026-11-28");
});

test("skips the off day (28 Nov 2026 is a Saturday)", () => {
  expect(nextServiceDate("2026-11-27", "SAT", today)).toBe("2026-11-29");
});

test("crosses month ends", () => {
  expect(nextServiceDate("2026-11-30", null, today)).toBe("2026-12-01");
});

test("an old last trip never schedules into the past", () => {
  expect(nextServiceDate("2026-11-01", null, today)).toBe(today);
  expect(nextServiceDate("2026-11-01", "THU", today)).toBe("2026-11-27"); // today is a Thursday
});

test("sales open at midnight Dhaka, 10 days before the journey", () => {
  expect(salesOpenFor("2026-11-28")).toBe("2026-11-18T00:00:00+06:00");
  expect(salesOpenFor("2026-12-05")).toBe("2026-11-25T00:00:00+06:00"); // across a month
});
