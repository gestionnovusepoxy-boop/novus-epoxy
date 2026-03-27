import nodemailer from 'nodemailer';

/**
 * Sends prospect/outreach emails FROM jason@novusepoxy.shop via Hostinger SMTP.
 * Used by Hunter (initial outreach) and Aria (follow-ups).
 * System/admin emails still go through Gmail API via sendEmail().
 */

const JASON_EMAIL = 'jason@novusepoxy.shop';
const JASON_PASSWORD = 'Jaydaytek300@';

const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 465,
  secure: true,
  auth: {
    user: JASON_EMAIL,
    pass: JASON_PASSWORD,
  },
});

export async function sendProspectEmail({
  to,
  subject,
  html,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ id: string }> {
  const info = await transporter.sendMail({
    from: `"Jason — Novus Epoxy" <${JASON_EMAIL}>`,
    to,
    subject,
    html,
    replyTo: replyTo ?? JASON_EMAIL,
  });

  return { id: info.messageId ?? `smtp-${Date.now()}` };
}
