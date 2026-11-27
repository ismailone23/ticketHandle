// Load test: users search, look at seat maps, and sometimes hold and release a seat.
//   docker run --rm -i --network host -v "$PWD/load:/load" grafana/k6 run /load/k6.js
// Env: THINK (1; 0 = no pauses), BASE (default http://localhost:8080), VUS (5000), RAMP (1m), HOLD_FOR (5m), HOLD (share of iterations that hold a seat, 0.05)
import http from "k6/http";
import { check, sleep as rawSleep } from "k6";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE || "http://localhost:8080";
const VUS = Number(__ENV.VUS || 5000);
const HOLD = Number(__ENV.HOLD || 0.05);
const THINK = Number(__ENV.THINK ?? 1); // think-time multiplier; THINK=0 sends requests back to back to find max throughput
const sleep = (s) => THINK > 0 && rawSleep(s * THINK);
const ORIGIN = __ENV.ORIGIN || "http://localhost:3001"; // must match WEB_ORIGIN for auth checks
const ROUTES = [["Dhaka", "Chattogram"], ["Chattogram", "Dhaka"]];
const DATES = (__ENV.DATES || "2026-11-27,2026-11-28").split(",");

const cookies = new SharedArray("cookies", () => JSON.parse(open("./users.json")));

export const options = {
  scenarios: {
    rush: {
      executor: "ramping-vus",
      stages: [
        { duration: __ENV.RAMP || "1m", target: VUS }, // ramp up
        { duration: __ENV.HOLD_FOR || "5m", target: VUS }, // hold at full load
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"], // under 1% errors
    http_req_duration: ["p(95)<800"], // 95% of requests under 800 ms
    "http_req_duration{name:search}": ["p(95)<800"],
    "http_req_duration{name:seats}": ["p(95)<800"],
  },
};

// 409 (seat taken) and 429 (hold limit) are correct answers under load, not failures
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409, 429));

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

export default function () {
  // each virtual user keeps one logged-in account
  const params = (name) => ({ headers: { cookie: cookies[(__VU - 1) % cookies.length], origin: ORIGIN, "content-type": "application/json" }, tags: { name } });
  const api = `${BASE}/api/journey/ticket`;

  check(http.get(`${api}/stations`, { tags: { name: "stations" } }), { "stations 200": (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);

  const [from, to] = pick(ROUTES);
  const date = pick(DATES);
  const search = http.get(`${api}/search?journeyDate=${date}&fromStation=${from}&toStation=${to}`, params("search"));
  check(search, { "search ok": (r) => r.status === 200 || r.status === 201 });
  const trips = search.json("data") || [];
  if (!trips.length) return;
  sleep(1 + Math.random() * 3);

  const trip = pick(trips).trip;
  const seats = http.get(`${api}/trips/${trip.id}/seats`, params("seats"));
  check(seats, { "seats 200": (r) => r.status === 200 });
  sleep(2 + Math.random() * 4);

  if (Math.random() >= HOLD) return;
  // compact seat map: [{ coach, type, seats: [[seatNumber, status]] }], status 0 = available
  const free = (seats.json("data") || []).flatMap((c) =>
    c.seats.filter((x) => x[1] === 0).map((x) => ({ coachCode: c.coach, seatType: c.type, seatNumber: x[0] })),
  );
  if (!free.length) return;
  const s = pick(free);
  const hold = http.post(
    `${api}/hold`,
    JSON.stringify({ tripId: trip.id, coachCode: s.coachCode, seatType: s.seatType, seatNumbers: [s.seatNumber] }),
    { ...params("hold"), headers: { ...params("hold").headers, "idempotency-key": `${__VU}-${__ITER}` } },
  );
  // 409 = someone else got the seat first, 429 = per-user hold limit: both are correct answers under load
  check(hold, { "hold answered": (r) => [201, 200, 409, 429].includes(r.status) });
  if (hold.status === 201) {
    sleep(1);
    const id = hold.json("data.order.id");
    check(http.del(`${api}/orders/${id}/hold`, null, params("release")), { "release 200": (r) => r.status === 200 });
  }
  sleep(1);
}
