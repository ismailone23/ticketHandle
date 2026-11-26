import { expect, test } from "bun:test";
import { setClass, setFare, withFare } from "./coach-fares";

const rows = [
  { seatType: "s_chair", taka: "" },
  { seatType: "s_chair", taka: "" },
  { seatType: "ac_s", taka: "" },
];

test("typing a fare fills the same class, not other classes", () => {
  const r = setFare(rows, 0, "405");
  expect(r.map((x) => x.taka)).toEqual(["405", "405", ""]);
});

test("a hand-typed fare is never overwritten", () => {
  let r = setFare(rows, 0, "405");
  r = setFare(r, 1, "380"); // coach 2 is cheaper on purpose
  r = setFare(r, 0, "420");
  expect(r.map((x) => x.taka)).toEqual(["420", "380", ""]);
});

test("switching class takes that class's fare; a new coach starts with it", () => {
  let r = setFare(rows, 2, "780");
  r = setClass(r, 1, "ac_s");
  expect(r[1]!.taka).toBe("780");
  expect(withFare(r, { seatType: "ac_s", taka: "" }).taka).toBe("780");
  expect(withFare(r, { seatType: "snigdha", taka: "" }).taka).toBe(""); // no fare known yet
});
