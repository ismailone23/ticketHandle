import { otpEmail, sendEmail } from "@acme/server/email";
import { log } from "@acme/server/log";

const mail = otpEmail("482913", "sign-in");
try {
  await sendEmail({ to: "ismailhsanprsnl@gmail.com", ...mail });
  log.info({ info: "Email sent" }, "[resend]");
} catch (e) {
  log.error({ err: e }, "[script-email]");
}
