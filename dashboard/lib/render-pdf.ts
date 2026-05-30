/**
 * Render arbitrary HTML to a PDF Buffer using a serverless-friendly headless Chromium.
 *
 * Why: pour attacher la facture en vraie PDF à l'email (au lieu d'un simple lien).
 * Used by app/api/invoices/[id]/send/route.ts.
 *
 * Setup:
 *   - @sparticuz/chromium-min — fournit les args + un downloader pour le binaire
 *     Chromium (le binaire lui-même est hébergé sur GitHub release pour rester < 50MB
 *     bundle Vercel).
 *   - puppeteer-core — pilote ce Chromium externe.
 *
 * Cold start: ~5-8s la première invocation (download + extract). Warm: <2s.
 */
import chromium from '@sparticuz/chromium-min';
import puppeteer, { type Browser } from 'puppeteer-core';

// Chromium 149.0.0 binary URL (matches the @sparticuz/chromium-min v149.0.0 package).
const CHROMIUM_PACK_URL =
  process.env.CHROMIUM_PACK_URL ??
  'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar';

export async function renderHtmlToPdf(html: string): Promise<Uint8Array> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    });
    const page = await browser.newPage();
    // setContent with `domcontentloaded` is faster than networkidle0 and avoids
    // hanging on remote-image timeouts. Logo loads from same Vercel origin so
    // it's quick anyway.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Wait briefly for fonts/images
    await page.evaluateHandle('document.fonts.ready').catch(() => {});
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' },
    });
    return pdf;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Fetch an invoice's print-ready HTML from the internal /api/invoices/{id}/pdf
 * route (auth via ADMIN_API_KEY) and render it to a PDF Buffer.
 */
export async function renderInvoicePdf(invoiceId: number, baseUrl: string, adminKey: string): Promise<Uint8Array> {
  const res = await fetch(`${baseUrl}/api/invoices/${invoiceId}/pdf`, {
    headers: { 'x-api-key': adminKey },
  });
  if (!res.ok) throw new Error(`Failed to fetch invoice HTML: ${res.status}`);
  const html = await res.text();
  // The HTML embeds a window.onload print() that we DON'T want during PDF render.
  // Strip it so the page doesn't trigger a recursive print dialog.
  const cleaned = html.replace(/<script>\s*window\.onload[^<]*<\/script>/i, '');
  return renderHtmlToPdf(cleaned);
}
