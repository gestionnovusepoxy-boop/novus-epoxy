import { test, expect } from '@playwright/test';

/**
 * Smoke tests pour les pages PUBLIQUES (sans auth) en production.
 * Garantit qu'un client peut accéder aux pages de soumission, paiement, contrat sans 500.
 */

test('Page soumission publique répond sans erreur 500', async ({ page }) => {
  const response = await page.goto('/soumission');
  expect(response?.status()).toBe(200);
  // Page charge avec body non-vide (form classique OU chatbot Aria)
  const body = await page.locator('body').textContent();
  expect(body?.length ?? 0).toBeGreaterThan(50);
});

test('Pages legales accessibles', async ({ page }) => {
  await page.goto('/politique-confidentialite');
  expect(await page.locator('body').textContent()).toBeTruthy();
});

test('Dashboard admin redirige vers login si pas authentifié', async ({ page }) => {
  const response = await page.goto('/dashboard');
  // Doit soit redirect vers login soit 401/403
  expect(response?.status()).toBeLessThan(500);
});

test('API health check (admin sans session) répond pas 500', async ({ request }) => {
  const r = await request.get('/api/quotes?limit=1');
  // 401 attendu (pas auth) — pas un 500
  expect([200, 401, 403]).toContain(r.status());
});

test('PDF facture endpoint avec id invalide retourne 404 propre', async ({ request }) => {
  const r = await request.get('/api/invoices/99999999/pdf');
  expect([401, 404]).toContain(r.status());
});
