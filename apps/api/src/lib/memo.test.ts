import { expect, test } from "bun:test";
import { memo } from "./memo";

test("shares one fetch, expires, and does not cache failures", async () => {
  let calls = 0;
  const fn = async () => ++calls;
  const [a, b] = await Promise.all([memo("k", 20, fn), memo("k", 20, fn)]);
  expect([a, b, calls]).toEqual([1, 1, 1]);
  await Bun.sleep(30);
  expect(await memo("k", 20, fn)).toBe(2);

  await expect(memo("bad", 1000, () => Promise.reject(new Error("x")))).rejects.toThrow();
  expect(await memo("bad", 1000, async () => "ok")).toBe("ok");
});
