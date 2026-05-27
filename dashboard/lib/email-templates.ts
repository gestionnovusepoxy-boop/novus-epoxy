/**
 * Shared email HTML templates for Novus Epoxy.
 * Keep the branded shell (logo + Luca/Jason signature + optional amber CTA)
 * in one place so cron replies, manual replies, and Aria stay in sync.
 */

export interface BrandedEmailOptions {
  /** Show the amber "Demander ma soumission gratuite" CTA button (default true) */
  showQuoteButton?: boolean;
  /** Override the CTA button label */
  cta?: string;
  /** Override the CTA button URL */
  ctaUrl?: string;
}

/** Wrap a body HTML fragment in the Novus Epoxy branded shell. */
export function brandedEmailHtml(bodyHtml: string, opts: BrandedEmailOptions = {}): string {
  const showQuoteButton = opts.showQuoteButton !== false;
  const ctaLabel = opts.cta ?? 'Demander ma soumission gratuite';
  // CTA points to the Vercel form (live form). novusepoxy.ca/#contact has no form (P1-13).
  const ctaUrl = opts.ctaUrl ?? 'https://novus-epoxy.vercel.app/#contact';
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:0;">
    <div style="background:#0f172a;padding:16px 24px;border-radius:8px 8px 0 0;">
      <img src="https://novus-epoxy.vercel.app/logo.jpg" alt="Novus Epoxy" style="height:40px;" />
    </div>
    <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
      <div style="color:#1e293b;line-height:1.7;">${bodyHtml}</div>
      ${showQuoteButton ? `<div style="text-align:center;margin:28px 0;">
        <a href="${ctaUrl}" style="background:#f59e0b;color:#0f172a;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;font-size:15px;">${ctaLabel}</a>
      </div>` : ''}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
      <p style="color:#64748b;font-size:12px;margin:0;line-height:1.6;">
        <b>Novus Epoxy</b> — Planchers epoxy haut de gamme<br/>
        RBQ 5861-8471-01 | Garantie 10 ans | 15 ans d'experience<br/><br/>
        📞 <b>Luca</b> (facturation / soumission) : <a href="tel:5813075983" style="color:#f59e0b;">581-307-5983</a><br/>
        📞 <b>Jason</b> (chantier / soumission) : <a href="tel:5813072678" style="color:#f59e0b;">581-307-2678</a><br/>
        🌐 <a href="https://novusepoxy.ca" style="color:#f59e0b;">novusepoxy.ca</a>
      </p>
    </div>
  </div>`;
}
