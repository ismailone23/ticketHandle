import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  user: {
    accounts: r.many.account(),
    orders: r.many.order(),
    tickets: r.many.ticket(),
  },
  account: {
    user: r.one.user({ from: r.account.userId, to: r.user.id }),
  },
  train: {
    coaches: r.many.coach(),
    trips: r.many.trip(),
  },
  coach: {
    train: r.one.train({ from: r.coach.trainId, to: r.train.id }),
  },
  trip: {
    train: r.one.train({ from: r.trip.trainId, to: r.train.id }),
    seats: r.many.tripSeat(),
    orders: r.many.order(),
  },
  tripSeat: {
    trip: r.one.trip({ from: r.tripSeat.tripId, to: r.trip.id }),
    order: r.one.order({ from: r.tripSeat.orderId, to: r.order.id }),
  },
  order: {
    user: r.one.user({ from: r.order.userId, to: r.user.id }),
    trip: r.one.trip({ from: r.order.tripId, to: r.trip.id }),
    seats: r.many.tripSeat(),
    payments: r.many.payment(),
    tickets: r.many.ticket(),
  },
  payment: {
    order: r.one.order({ from: r.payment.orderId, to: r.order.id }),
  },
  ticket: {
    order: r.one.order({ from: r.ticket.orderId, to: r.order.id }),
    trip: r.one.trip({ from: r.ticket.tripId, to: r.trip.id }),
    seat: r.one.tripSeat({ from: r.ticket.tripSeatId, to: r.tripSeat.id }),
    user: r.one.user({ from: r.ticket.userId, to: r.user.id }),
  },
}));
