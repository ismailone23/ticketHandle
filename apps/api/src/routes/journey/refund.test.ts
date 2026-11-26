import { expect, test } from "bun:test";
import { departureAt, refundPercent } from "./refund";

test("refund tiers", () => {
  expect(refundPercent(100)).toBe(90);
  expect(refundPercent(48)).toBe(90);
  expect(refundPercent(47.9)).toBe(80);
  expect(refundPercent(36)).toBe(80);
  expect(refundPercent(24)).toBe(70);
  expect(refundPercent(12)).toBe(50);
  expect(refundPercent(6)).toBe(20);
  expect(refundPercent(5.9)).toBe(0);
  expect(refundPercent(-1)).toBe(0);
});

test("departure is Dhaka time", () => {
  expect(departureAt("2026-11-26", "07:30:00").toISOString()).toBe(
    "2026-11-26T01:30:00.000Z",
  );
});
