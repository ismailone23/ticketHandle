import { createAccessControl } from "better-auth/plugins";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

export const statement = {
  ...defaultStatements,
  event: ["create", "update", "delete", "publish"],
  ticket: ["purchase", "scan", "refund"],
} as const;

export const ac = createAccessControl(statement);

export const buyer = ac.newRole({
  ticket: ["purchase"],
});

export const organizer = ac.newRole({
  event: ["create", "update", "delete", "publish"],
  ticket: ["purchase", "scan"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  event: ["create", "update", "delete", "publish"],
  ticket: ["purchase", "scan", "refund"],
});

export const roles = { buyer, organizer, admin };
