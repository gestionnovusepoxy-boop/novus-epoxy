/**
 * Property-based invariants pour le moteur de pricing.
 * Run: node --test dashboard/tests/pricing.invariants.test.mjs
 * Pas de framework externe — utilise node:test built-in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Reproduit la logique de calculateQuoteWithExtras (lib/pricing.ts) en pur JS pour tester.
const SERVICES = {
  flake: 8.50, metallique: 12.75, couleur_unie: 7.50, quartz: 11.00, antiderapant: 10.00,
  commercial: 15.00, meulage: 3.50, autonivelant: 3.25, vinyl_click: 2.00,
};
const TPS = 0.05, TVQ = 0.09975, DEPOT = 0.30;
const r2 = n => Math.round(n * 100) / 100;

function calc({ serviceType, superficie, prixPiedCarre, sousTotalService, rabaisPct, extrasTotal }) {
  const isPrixFixe = (!prixPiedCarre || prixPiedCarre === 0) && sousTotalService > 0;
  const knownPrix = SERVICES[serviceType] ?? prixPiedCarre ?? 0;
  const serviceBrut = isPrixFixe ? sousTotalService : r2(knownPrix * superficie);
  const rabaisMontant = r2(serviceBrut * (rabaisPct / 100));
  const serviceNet = r2(serviceBrut - rabaisMontant);
  const extrasNet = r2(extrasTotal);
  const sousTotal = r2(serviceNet + extrasNet);
  const tps = r2(sousTotal * TPS);
  const tvq = r2(sousTotal * TVQ);
  const total = r2(sousTotal + tps + tvq);
  const depot = r2(total * DEPOT);
  return { serviceBrut, serviceNet, rabaisMontant, extrasNet, sousTotal, tps, tvq, total, depot };
}

// Generator: random valid quote input
function gen(seed) {
  const r = (n) => Math.floor(Math.abs(Math.sin(seed++) * 100000)) % n;
  const services = Object.keys(SERVICES);
  return {
    serviceType: services[r(services.length)],
    superficie: 100 + r(5000),
    prixPiedCarre: undefined,
    sousTotalService: 0,
    rabaisPct: r(31), // 0-30%
    extrasTotal: r(15000),
  };
}

test('I1: total >= 0', () => {
  for (let i = 0; i < 500; i++) {
    const out = calc(gen(i));
    assert.ok(out.total >= 0, `total negatif au seed ${i}: ${out.total}`);
  }
});

test('I2: total = sousTotal + tps + tvq (cents-equivalent)', () => {
  for (let i = 0; i < 500; i++) {
    const out = calc(gen(i + 1000));
    const reconstructed = r2(out.sousTotal + out.tps + out.tvq);
    assert.ok(Math.abs(out.total - reconstructed) < 0.02, `seed ${i}: total ${out.total} ≠ ${reconstructed}`);
  }
});

test('I3: tps = sousTotal × 5% (à 1 cent près)', () => {
  for (let i = 0; i < 500; i++) {
    const out = calc(gen(i + 2000));
    const expected = r2(out.sousTotal * TPS);
    assert.ok(Math.abs(out.tps - expected) < 0.02, `seed ${i}: tps ${out.tps} ≠ ${expected}`);
  }
});

test('I4: tvq = sousTotal × 9.975% (à 1 cent près)', () => {
  for (let i = 0; i < 500; i++) {
    const out = calc(gen(i + 3000));
    const expected = r2(out.sousTotal * TVQ);
    assert.ok(Math.abs(out.tvq - expected) < 0.02, `seed ${i}: tvq ${out.tvq} ≠ ${expected}`);
  }
});

test('I5: depot = total × 30%', () => {
  for (let i = 0; i < 500; i++) {
    const out = calc(gen(i + 4000));
    const expected = r2(out.total * DEPOT);
    assert.ok(Math.abs(out.depot - expected) < 0.02, `seed ${i}: depot ${out.depot} ≠ ${expected}`);
  }
});

test('I6: rabais s\'applique UNIQUEMENT au service, jamais aux extras', () => {
  for (let i = 0; i < 500; i++) {
    const g = gen(i + 5000);
    const withRabais = calc(g);
    const withoutRabais = calc({ ...g, rabaisPct: 0 });
    // Difference = exactly rabais on service brut, extras identiques
    const diffSousTotal = r2(withoutRabais.sousTotal - withRabais.sousTotal);
    const expectedDiff = withRabais.rabaisMontant;
    assert.ok(Math.abs(diffSousTotal - expectedDiff) < 0.02,
      `seed ${i}: diff sous_total ${diffSousTotal} ≠ rabais ${expectedDiff} (les extras devraient être identiques)`);
    assert.strictEqual(withRabais.extrasNet, withoutRabais.extrasNet,
      `seed ${i}: extras affectés par rabais (${withRabais.extrasNet} vs ${withoutRabais.extrasNet})`);
  }
});

test('I7: ajouter un extra augmente sous_total exactement de son montant', () => {
  for (let i = 0; i < 500; i++) {
    const g = gen(i + 6000);
    const base = calc(g);
    const plusExtra = calc({ ...g, extrasTotal: g.extrasTotal + 500 });
    const diff = r2(plusExtra.sousTotal - base.sousTotal);
    assert.ok(Math.abs(diff - 500) < 0.02, `seed ${i}: ajouter 500$ d'extra a donné +${diff}`);
  }
});

test('I8: cas Novus #237 (charles, 2952 pi² flake @ 8.50, 15% rabais, extras 6830)', () => {
  const out = calc({
    serviceType: 'flake',
    superficie: 2952,
    prixPiedCarre: 8.50,
    sousTotalService: 0,
    rabaisPct: 15,
    extrasTotal: 6830,
  });
  assert.strictEqual(out.serviceBrut, 25092);
  assert.strictEqual(out.rabaisMontant, 3763.80);
  assert.strictEqual(out.serviceNet, 21328.20);
  assert.strictEqual(out.sousTotal, 28158.20);
  assert.strictEqual(out.tps, 1407.91);
  assert.ok(Math.abs(out.tvq - 2808.78) < 0.02, `tvq attendu ~2808.78, reçu ${out.tvq}`);
  assert.ok(out.total >= 32374 && out.total <= 32376, `total hors range: ${out.total}`);
});

test('I9: prix fixe (prix_pied_carre = 0, sousTotalService > 0) — ignore prix/superficie', () => {
  const out = calc({
    serviceType: 'flake',
    superficie: 9999, // arbitraire
    prixPiedCarre: 0,
    sousTotalService: 5000, // prix fixe
    rabaisPct: 10,
    extrasTotal: 1000,
  });
  assert.strictEqual(out.serviceBrut, 5000);
  assert.strictEqual(out.rabaisMontant, 500);
  assert.strictEqual(out.serviceNet, 4500);
  assert.strictEqual(out.sousTotal, 5500); // 4500 + 1000
});

test('I10: rabais 0% = service brut exactement', () => {
  for (let i = 0; i < 200; i++) {
    const g = { ...gen(i + 7000), rabaisPct: 0 };
    const out = calc(g);
    assert.strictEqual(out.rabaisMontant, 0);
    assert.strictEqual(out.serviceNet, out.serviceBrut);
  }
});
