// Fares follow the class: coaches of one class share a fare unless one was typed by hand.
export type FareRow = { seatType: string; taka: string; custom?: boolean };

const fareOf = <R extends FareRow>(rows: R[], seatType: string, skip: number) =>
  rows.find((r, j) => j !== skip && r.seatType === seatType && r.taka !== "")?.taka;

// typing a fare: that coach keeps it; same-class coaches nobody customised follow it
export const setFare = <R extends FareRow>(rows: R[], i: number, taka: string): R[] =>
  rows.map((r, j) => (j === i ? { ...r, taka, custom: true } : r.seatType === rows[i]!.seatType && !r.custom ? { ...r, taka } : r));

// changing class: take that class's fare if another coach already has one
export const setClass = <R extends FareRow>(rows: R[], i: number, seatType: string): R[] =>
  rows.map((r, j) => (j === i ? { ...r, seatType, taka: fareOf(rows, seatType, i) ?? r.taka, custom: false } : r));

// a new coach starts with its class's fare
export const withFare = <R extends FareRow>(rows: R[], row: R): R => ({ ...row, taka: fareOf(rows, row.seatType, -1) ?? row.taka });
