import { Resend } from "resend";
import { env } from "../env";
import { log } from "../lib/logger";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};
export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
  // No key in dev: print to the console instead of failing
  if (!resend) {
    console.log(
      `\n📧 [dev email] to=${to}\nsubject: ${subject}\n${text ?? html}\n`,
    );
    return;
  }

  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
  });

  if (error) {
    log.error({ err: error.message, name: error.name }, "[resend]");
    throw new Error(`Email send failed: ${error.message}`);
  }
}

export function otpEmail(otp: string, purpose: string) {
  const title =
    purpose === "sign-in"
      ? "Your sign-in code"
      : purpose === "email-verification"
        ? "Verify your email"
        : "Reset your password";

  return {
    subject: title,
    text: `${title}: ${otp}\nThis code expires in 5 minutes.`,
    html: `
      <div style="font-family:sans-serif">
        <h2>${title}</h2>
        <p style="font-size:28px;letter-spacing:6px;font-weight:bold">${otp}</p>
        <p>This code expires in 5 minutes. If you didn't request it, ignore this email.</p>
      </div>`,
  };
}
