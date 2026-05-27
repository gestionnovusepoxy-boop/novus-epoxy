'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ServiceType } from '@/lib/api';
import { SERVICES, calculateMultiQuote, formatMoney, EXTRAS_PREDEFINIS } from '@/lib/pricing';

interface ActivePromoDTO {
  nom: string;
  rabais_pct: number;
  date_fin: string | null;
}

interface ServiceItem {
  type_service: ServiceType;
  superficie: string;
  prix_fixe: boolean;
  prix_fixe_montant: string;
}

interface ExtraItem {
  description: string;
  quantite: string;
  prix_unitaire: string;
}

export default function NouveauDevisPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [ccEmail, setCcEmail] = useState('');

  const serviceParam = searchParams.get('service') ?? '';
  const validService = serviceParam in SERVICES ? serviceParam as ServiceType : 'flake';

  const [form, setForm] = useState({
    client_nom: searchParams.get('nom') ?? '',
    client_email: searchParams.get('email') ?? '',
    client_tel: searchParams.get('tel') ?? '',
    client_adresse: searchParams.get('ville') ?? '',
    etat_plancher: '',
    notes: searchParams.get('notes') ?? '',
    rabais_pct: 0,
  });

  // Promo dynamique — source unique = table `promotions` (lib/promotions.ts)
  const [promo, setPromo] = useState<ActivePromoDTO | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/promotions/active')
      .then(r => r.ok ? r.json() : [])
      .then((rows: ActivePromoDTO[]) => {
        if (cancelled) return;
        const p = rows[0] ?? null;
        setPromo(p);
        if (p) setForm(prev => ({ ...prev, rabais_pct: Number(p.rabais_pct) }));
      })
      .catch(() => { /* pas de promo */ });
    return () => { cancelled = true; };
  }, []);

  const [items, setItems] = useState<ServiceItem[]>([
    { type_service: validService, superficie: searchParams.get('superficie') ?? '', prix_fixe: false, prix_fixe_montant: '' },
  ]);

  const [extras, setExtras] = useState<ExtraItem[]>([]);

  // Calculate preview — keep extras à $0 (= "INCLUS", montre le travail au client)
  const validItems = items.filter(i => i.prix_fixe ? parseFloat(i.prix_fixe_montant) > 0 : parseFloat(i.superficie) > 0);
  const validExtras = extras.filter(e => e.description && e.description.trim().length > 0);
  const preview = validItems.length > 0 ? calculateMultiQuote(
    validItems.map(i => ({
      type_service: i.type_service,
      superficie: parseFloat(i.superficie) || 0,
      prix_fixe: i.prix_fixe ? parseFloat(i.prix_fixe_montant) : undefined,
    })),
    validExtras.map(e => ({ description: e.description, quantite: parseFloat(e.quantite) || 1, prix_unitaire: parseFloat(e.prix_unitaire) })),
    form.rabais_pct,
  ) : null;

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function addItem() {
    setItems(prev => [...prev, { type_service: 'flake', superficie: '', prix_fixe: false, prix_fixe_montant: '' }]);
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, field: keyof ServiceItem, value: string) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function addExtra(preset?: typeof EXTRAS_PREDEFINIS[number]) {
    setExtras(prev => [...prev, {
      description: preset?.label ?? '',
      quantite: '1',
      prix_unitaire: preset ? String(preset.prix_defaut) : '',
    }]);
  }

  function removeExtra(idx: number) {
    setExtras(prev => prev.filter((_, i) => i !== idx));
  }

  function updateExtra(idx: number, field: keyof ExtraItem, value: string) {
    setExtras(prev => prev.map((ex, i) => i === idx ? { ...ex, [field]: value } : ex));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validItems.length === 0) { setError('Ajoutez au moins un service'); return; }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_nom: form.client_nom,
          client_email: form.client_email,
          client_tel: form.client_tel || undefined,
          client_adresse: form.client_adresse || undefined,
          etat_plancher: form.etat_plancher || undefined,
          notes: form.notes || undefined,
          rabais_pct: form.rabais_pct,
          items: validItems.map(i => ({
            type_service: i.type_service,
            superficie: parseFloat(i.superficie) || 0,
            prix_fixe: i.prix_fixe ? parseFloat(i.prix_fixe_montant) : undefined,
          })),
          extras: validExtras.map(e => ({ description: e.description, quantite: parseFloat(e.quantite) || 1, prix_unitaire: parseFloat(e.prix_unitaire) })),
        }),
      });
      if (!res.ok) throw new Error('API error');
      const quote = await res.json();
      const ccParam = ccEmail ? `?cc=${encodeURIComponent(ccEmail)}` : '';
      router.push(`/dashboard/devis/${quote.id}${ccParam}`);
    } catch {
      setError('Erreur lors de la creation du devis');
      setLoading(false);
    }
  }

  const inputClass = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500';

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-bold text-white mb-6">Nouveau devis</h2>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
          <h3 className="text-white font-semibold text-sm uppercase tracking-wider">Client</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Nom *</label>
              <input required value={form.client_nom} onChange={e => updateForm('client_nom', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Courriel *</label>
              <input type="email" required value={form.client_email} onChange={e => updateForm('client_email', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Telephone</label>
              <input type="tel" value={form.client_tel} onChange={e => updateForm('client_tel', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Adresse</label>
              <input value={form.client_adresse} onChange={e => updateForm('client_adresse', e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">CC — copie email (optionnel)</label>
            <input type="email" value={ccEmail} onChange={e => setCcEmail(e.target.value)} placeholder="ex: jason@gmail.com" className={inputClass} />
          </div>
        </div>

        {/* Services */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider">Services</h3>
            <button type="button" onClick={addItem} className="text-amber-400 hover:text-amber-300 text-sm font-medium">+ Ajouter un service</button>
          </div>

          {items.map((item, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-sm text-slate-400 mb-1">Type de service *</label>
                  <select
                    value={item.type_service} onChange={e => updateItem(idx, 'type_service', e.target.value)}
                    className={inputClass}
                  >
                    {Object.entries(SERVICES).map(([key, { label, prix }]) => (
                      <option key={key} value={key}>{label} — {formatMoney(prix)}/pi²</option>
                    ))}
                  </select>
                </div>
                {!item.prix_fixe && (
                  <div className="w-36">
                    <label className="block text-sm text-slate-400 mb-1">Superficie (pi²) *</label>
                    <input
                      type="number" min="1" step="0.01"
                      value={item.superficie} onChange={e => updateItem(idx, 'superficie', e.target.value)}
                      className={inputClass}
                    />
                  </div>
                )}
                {item.prix_fixe && (
                  <div className="w-36">
                    <label className="block text-sm text-slate-400 mb-1">Prix fixe ($) *</label>
                    <input
                      type="number" min="1" step="0.01"
                      value={item.prix_fixe_montant} onChange={e => updateItem(idx, 'prix_fixe_montant', e.target.value)}
                      placeholder="Ex: 2500"
                      className={inputClass}
                    />
                  </div>
                )}
                <div className="w-20 text-right text-sm text-slate-400 pb-2.5">
                  {item.prix_fixe
                    ? (parseFloat(item.prix_fixe_montant) > 0 && formatMoney(parseFloat(item.prix_fixe_montant)))
                    : (parseFloat(item.superficie) > 0 && formatMoney(SERVICES[item.type_service].prix * parseFloat(item.superficie)))
                  }
                </div>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-300 pb-2.5 text-lg">✕</button>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none pl-1">
                <input
                  type="checkbox"
                  checked={item.prix_fixe}
                  onChange={e => {
                    const checked = e.target.checked;
                    setItems(prev => prev.map((it, i) => i === idx ? { ...it, prix_fixe: checked } : it));
                  }}
                  className="w-3.5 h-3.5 accent-amber-500"
                />
                <span className="text-xs text-slate-400">Prix fixe (patio, balcon, etc.)</span>
              </label>
            </div>
          ))}
        </div>

        {/* Extras */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider">Extras / Travaux inclus</h3>
            <div className="flex gap-2">
              <button type="button" onClick={() => addExtra()} className="text-amber-400 hover:text-amber-300 text-sm font-medium border border-amber-500/30 rounded px-2 py-1">+ Payant</button>
              <button type="button" onClick={() => setExtras(prev => [...prev, { description: '', quantite: '1', prix_unitaire: '0' }])} className="text-emerald-400 hover:text-emerald-300 text-sm font-medium border border-emerald-500/30 rounded px-2 py-1">+ Inclus (gratuit)</button>
            </div>
          </div>

          {/* Quick add presets — séparés payants / inclus */}
          <div>
            <p className="text-amber-400/80 text-xs font-bold uppercase mb-1">Matériaux & prep — PAYANT</p>
            <div className="flex flex-wrap gap-2">
              {EXTRAS_PREDEFINIS.filter(p => !p.inclus).map(preset => (
                <button
                  key={preset.key} type="button"
                  onClick={() => addExtra(preset)}
                  className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg px-3 py-1.5 text-sm text-amber-200 transition"
                >
                  + {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-emerald-400/80 text-xs font-bold uppercase mb-1">Travail inclus — montre la valeur au client (gratuit, ✓ INCLUS)</p>
            <div className="flex flex-wrap gap-2">
              {EXTRAS_PREDEFINIS.filter(p => p.inclus).map(preset => (
                <button
                  key={preset.key} type="button"
                  onClick={() => addExtra(preset)}
                  className="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg px-3 py-1.5 text-sm text-emerald-200 transition"
                >
                  + {preset.label}
                </button>
              ))}
            </div>
          </div>

          {extras.map((ex, idx) => {
            const isIncluded = parseFloat(ex.prix_unitaire || '0') === 0;
            return (
              <div key={idx} className={`flex items-end gap-3 rounded-lg p-2 ${isIncluded ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-slate-900/30'}`}>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Description {isIncluded && <span className="text-emerald-400 ml-1">✓ INCLUS au client</span>}</label>
                  <input
                    value={ex.description} onChange={e => updateExtra(idx, 'description', e.target.value)}
                    placeholder="Ex: Auto-nivelant Ardex, Préparation HEPA..."
                    className={inputClass}
                  />
                </div>
                <div className="w-16">
                  <label className="block text-xs text-slate-400 mb-1">Qté</label>
                  <input
                    type="number" min="1" step="1"
                    value={ex.quantite} onChange={e => updateExtra(idx, 'quantite', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="w-24">
                  <label className="block text-xs text-slate-400 mb-1">Prix $ {isIncluded ? '(0 = inclus)' : ''}</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={ex.prix_unitaire} onChange={e => updateExtra(idx, 'prix_unitaire', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className={`w-24 text-right text-sm pb-2.5 ${isIncluded ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                  {isIncluded ? '✓ INCLUS' : formatMoney((parseFloat(ex.quantite) || 1) * parseFloat(ex.prix_unitaire || '0'))}
                </div>
                <button type="button" onClick={() => removeExtra(idx)} className="text-red-400 hover:text-red-300 pb-2.5 text-lg">✕</button>
              </div>
            );
          })}

          {extras.length === 0 && (
            <p className="text-slate-500 text-sm">💡 Ajoute des extras payants OU des travaux gratuits (étiquetés "✓ INCLUS") pour montrer toute la valeur de ton service.</p>
          )}
        </div>

        {/* Notes + options */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
          <h3 className="text-white font-semibold text-sm uppercase tracking-wider">Details</h3>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Etat du plancher</label>
            <input
              value={form.etat_plancher} onChange={e => updateForm('etat_plancher', e.target.value)}
              placeholder="Ex: Beton brut, peinture existante..."
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Notes</label>
            <textarea
              rows={3} value={form.notes} onChange={e => updateForm('notes', e.target.value)}
              className={`${inputClass} resize-none`}
            />
          </div>
          {promo && (
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.rabais_pct === Number(promo.rabais_pct)}
                onChange={e => setForm(prev => ({ ...prev, rabais_pct: e.target.checked ? Number(promo.rabais_pct) : 0 }))}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-sm text-amber-400 font-medium">Appliquer {promo.nom} ({promo.rabais_pct}%)</span>
            </label>
          )}
        </div>

        {/* Preview prix */}
        {preview && (
          <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6">
            <h3 className="text-amber-400 font-semibold text-sm uppercase tracking-wider mb-4">Apercu du prix</h3>
            <div className="space-y-2 text-sm">
              {/* Service items */}
              {preview.items.map((item, idx) => (
                <div key={idx} className="flex justify-between text-slate-300">
                  <span>{SERVICES[item.type_service].label} x {item.superficie} pi²</span>
                  <span>{formatMoney(item.sous_total)}</span>
                </div>
              ))}

              {/* Extras */}
              {preview.extras.map((ex, idx) => {
                const isIncluded = Number(ex.sous_total) === 0;
                return (
                  <div key={idx} className={`flex justify-between ${isIncluded ? 'text-emerald-400' : 'text-slate-300'}`}>
                    <span>{ex.description} {ex.quantite > 1 ? `x${ex.quantite}` : ''}</span>
                    <span>{isIncluded ? '✓ INCLUS' : formatMoney(ex.sous_total)}</span>
                  </div>
                );
              })}

              {preview.rabais_pct > 0 && (
                <div className="flex justify-between text-green-400 font-medium">
                  <span>{promo?.nom ?? 'Rabais'} {preview.rabais_pct}% (sur services)</span>
                  <span>-{formatMoney(preview.rabais_montant)}</span>
                </div>
              )}

              <div className="flex justify-between text-slate-300 pt-1 border-t border-slate-700">
                <span>Sous-total</span>
                <span>{formatMoney(preview.sous_total)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>TPS (5%)</span>
                <span>{formatMoney(preview.tps)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>TVQ (9,975%)</span>
                <span>{formatMoney(preview.tvq)}</span>
              </div>
              <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-slate-700">
                <span>Total</span>
                <span>{formatMoney(preview.total)}</span>
              </div>
              <div className="flex justify-between text-amber-400 font-medium">
                <span>Depot requis (30%)</span>
                <span>{formatMoney(preview.depot_requis)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit" disabled={loading}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold rounded-lg px-6 py-2.5 text-sm transition"
          >
            {loading ? 'Creation...' : 'Creer le devis'}
          </button>
          <button
            type="button" onClick={() => router.back()}
            className="bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-6 py-2.5 text-sm transition"
          >
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}
