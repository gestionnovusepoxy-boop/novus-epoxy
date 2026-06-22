'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SoumissionForm() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    nom: '',
    email: '',
    telephone: '',
    service: '',
    type_projet: '',
    surface_estimee: '',
    adresse: '',
    ville: '',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    referrer: '',
  });

  useEffect(() => {
    setForm(f => ({
      ...f,
      utm_source: searchParams.get('utm_source') ?? '',
      utm_medium: searchParams.get('utm_medium') ?? '',
      utm_campaign: searchParams.get('utm_campaign') ?? '',
      referrer: document.referrer ?? '',
    }));
  }, [searchParams]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // 3 catégories de fini visuelles (mappées sur les services backend)
  const finis = [
    { value: 'Finition Flake', label: 'Flocon', desc: 'Le plus populaire', icon: '✨' },
    { value: 'Finition Metallique', label: 'Metallique', desc: 'Effet marbre luxueux', icon: '🌊' },
    { value: 'Couleur unie', label: 'Couleur unie', desc: 'Fini lisse uniforme', icon: '🎨' },
  ];

  // 4 espaces max
  const espaces = [
    { value: 'Garage', icon: '🚗', desc: 'Plancher de garage' },
    { value: 'Sous-sol', icon: '🏠', desc: 'Espace de vie' },
    { value: 'Commercial', icon: '🏢', desc: 'Bureau / commerce' },
    { value: 'Autre', icon: '🏗️', desc: 'Balcon, atelier, etc.' },
  ];

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) setDone(true);
    } catch { /* */ }
    setSubmitting(false);
  }

  // Labels pour 3 etapes
  const stepLabels = ['Espace', 'Projet', 'Fini'];

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0f172a] via-[#1e293b] to-[#0f172a] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-gradient-to-br from-[#1e293b] to-[#0f172a] border border-amber-400/30 rounded-3xl p-8 shadow-2xl shadow-amber-400/5">
            <div className="w-20 h-20 bg-gradient-to-br from-amber-400 to-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-[#0f172a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">Merci {form.nom.split(' ')[0]}!</h2>
            <p className="text-slate-400 mb-6 text-base leading-relaxed">
              Votre soumission est en preparation. On vous contacte tres bientot!
            </p>
            <div className="bg-amber-400/10 border border-amber-400/30 rounded-2xl p-5 mb-6">
              <p className="text-amber-400 font-bold text-xl mb-1">15% de rabais appliqué!</p>
              <p className="text-amber-400/60 text-sm">Offre valide jusqu'au 31 mai 2026</p>
            </div>
            <div className="space-y-3">
              <a href="tel:5813075983" className="flex items-center justify-center gap-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 rounded-xl p-3 transition-all">
                <span className="text-lg">📞</span>
                <span className="text-white font-medium">Luca — 581-307-5983</span>
              </a>
              <a href="tel:5813072678" className="flex items-center justify-center gap-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 rounded-xl p-3 transition-all">
                <span className="text-lg">📞</span>
                <span className="text-white font-medium">Jason — 581-307-2678</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0f172a] via-[#1e293b] to-[#0f172a] flex flex-col items-center">
      <div className="w-full max-w-lg">

        {/* Header compact */}
        <div className="pt-5 pb-3 px-5 flex items-center gap-3">
          <img src="/logo-email.jpg" alt="Novus Epoxy" className="w-11 h-11 rounded-xl shadow-lg" />
          <div>
            <h1 className="text-amber-400 text-lg font-bold leading-tight">Novus Epoxy</h1>
            <p className="text-slate-500 text-[11px]">Planchers epoxy haut de gamme</p>
          </div>
        </div>

        {/* Promo banner — simple */}
        <div className="mx-4 mb-4">
          <div className="bg-gradient-to-r from-amber-400 to-amber-500 rounded-2xl px-4 py-3 text-center shadow-lg shadow-amber-400/20">
            <p className="text-[#0f172a] font-extrabold text-lg leading-tight">Soumission gratuite — 15% de rabais</p>
          </div>
        </div>

        {/* Progress bar with labels — 3 etapes */}
        <div className="mx-4 mb-5">
          <div className="flex gap-1.5 mb-1.5">
            {[0,1,2].map(i => (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= step ? 'bg-amber-400' : 'bg-slate-700/50'}`} />
            ))}
          </div>
          <div className="flex justify-between px-1">
            {stepLabels.map((label, i) => (
              <span key={label} className={`text-[11px] transition-all ${i <= step ? 'text-amber-400/80' : 'text-slate-600'}`}>{label}</span>
            ))}
          </div>
        </div>

        {/* Card container */}
        <div className="mx-4 mb-6">
          <div className="bg-[#1e293b]/80 backdrop-blur border border-slate-700/50 rounded-2xl p-5 shadow-xl min-h-[300px]">

            {/* Step 0: Espace */}
            {step === 0 && (
              <div>
                <h2 className="text-white text-xl font-bold mb-1">C'est pour quel espace?</h2>
                <p className="text-slate-400 text-sm mb-4">Selectionnez le type d'espace</p>
                <div className="space-y-2">
                  {espaces.map(e => (
                    <button
                      key={e.value}
                      onClick={() => { set('type_projet', e.value); setStep(1); }}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-slate-600/50 hover:border-amber-400/60 active:border-amber-400 bg-slate-800/50 hover:bg-slate-700/50 transition-all text-left"
                    >
                      <span className="text-3xl">{e.icon}</span>
                      <div>
                        <p className="font-bold text-white text-base">{e.value}</p>
                        <p className="text-slate-400 text-xs">{e.desc}</p>
                      </div>
                      <svg className="w-5 h-5 text-slate-600 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1: Superficie + Nom + Telephone */}
            {step === 1 && (
              <div>
                <h2 className="text-white text-xl font-bold mb-1">Votre projet</h2>
                <p className="text-slate-400 text-sm mb-4">Superficie et vos coordonnees</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-400 text-xs font-medium mb-1 block">Superficie approximative (pi²) *</label>
                    <div className="relative">
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="Ex: 475"
                        value={form.surface_estimee}
                        onChange={e => set('surface_estimee', e.target.value)}
                        className="w-full bg-slate-800/50 border-2 border-slate-600/50 text-white rounded-xl p-3.5 pr-14 text-base font-bold focus:border-amber-400 focus:outline-none transition-all placeholder:text-slate-600"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-amber-400 font-bold text-sm">pi²</span>
                    </div>
                    <p className="text-slate-500 text-[11px] mt-1">Pas sur? Estimez — on confirme sur place.</p>
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs font-medium mb-1 block">Nom complet *</label>
                    <input
                      type="text"
                      placeholder="Jean Tremblay"
                      value={form.nom}
                      onChange={e => set('nom', e.target.value)}
                      autoComplete="name"
                      className="w-full bg-slate-800/50 border-2 border-slate-600/50 text-white rounded-xl p-3.5 text-base focus:border-amber-400 focus:outline-none transition-all placeholder:text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs font-medium mb-1 block">Telephone *</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      placeholder="581-555-1234"
                      value={form.telephone}
                      onChange={e => set('telephone', e.target.value)}
                      autoComplete="tel"
                      className="w-full bg-slate-800/50 border-2 border-slate-600/50 text-white rounded-xl p-3.5 text-base focus:border-amber-400 focus:outline-none transition-all placeholder:text-slate-600"
                    />
                  </div>
                </div>
                {form.surface_estimee && Number(form.surface_estimee) > 0 && form.nom && form.telephone && (
                  <button onClick={() => setStep(2)} className="w-full mt-4 bg-gradient-to-r from-amber-400 to-amber-500 text-[#0f172a] font-bold py-3.5 rounded-xl text-lg hover:from-amber-500 hover:to-amber-600 active:from-amber-600 active:to-amber-700 transition-all shadow-lg shadow-amber-400/20">
                    Presque fini! →
                  </button>
                )}
              </div>
            )}

            {/* Step 2: Fini (3 categories visuelles) + Email */}
            {step === 2 && (
              <div>
                <h2 className="text-white text-xl font-bold mb-1">Quel fini vous plait?</h2>
                <p className="text-slate-400 text-sm mb-4">Choisissez un style — on en discute ensuite</p>
                <div className="grid grid-cols-3 gap-2.5 mb-4">
                  {finis.map(s => (
                    <button
                      key={s.value}
                      onClick={() => set('service', s.value)}
                      className={`group relative overflow-hidden rounded-xl border-2 transition-all text-center p-3 ${form.service === s.value ? 'border-amber-400 bg-amber-400/10' : 'border-slate-600/50 hover:border-amber-400/60 bg-slate-800/50'}`}
                    >
                      <span className="text-3xl block mb-1">{s.icon}</span>
                      <p className={`font-bold text-sm ${form.service === s.value ? 'text-amber-400' : 'text-white'}`}>{s.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{s.desc}</p>
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-slate-400 text-xs font-medium mb-1 block">Courriel *</label>
                  <input
                    type="email"
                    inputMode="email"
                    placeholder="votre@courriel.com"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    autoComplete="email"
                    className="w-full bg-slate-800/50 border-2 border-slate-600/50 text-white rounded-xl p-3.5 text-base focus:border-amber-400 focus:outline-none transition-all placeholder:text-slate-600"
                  />
                </div>
                {form.service && form.email && (
                  <button
                    onClick={submit}
                    disabled={submitting}
                    className="w-full mt-4 bg-gradient-to-r from-amber-400 to-amber-500 text-[#0f172a] font-extrabold py-4 rounded-xl text-lg hover:from-amber-500 hover:to-amber-600 active:from-amber-600 active:to-amber-700 transition-all shadow-lg shadow-amber-400/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        Envoi en cours...
                      </span>
                    ) : 'Envoyer ma soumission gratuite'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Back button */}
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="mt-3 text-slate-500 hover:text-slate-300 text-sm w-full text-center transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Retour
            </button>
          )}
        </div>

        {/* Trust section */}
        <div className="mx-4 mb-6">
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: '🏆', text: 'Licence RBQ', sub: '5861-8471-01' },
              { icon: '🛡️', text: 'Garantie', sub: '10 ans' },
              { icon: '⭐', text: 'Experience', sub: '15 ans / 1000+ projets' },
              { icon: '💳', text: 'Paiement', sub: 'Interac ou credit (+3%)' },
            ].map(b => (
              <div key={b.text} className="flex items-center gap-2.5 bg-slate-800/30 border border-slate-700/30 rounded-xl p-3">
                <span className="text-lg">{b.icon}</span>
                <div>
                  <p className="text-white text-xs font-semibold">{b.text}</p>
                  <p className="text-slate-500 text-[10px]">{b.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom contact bar */}
        <div className="mx-4 mb-8">
          <a href="tel:5813075983" className="flex items-center justify-center gap-2 bg-slate-800/50 border border-slate-700/30 rounded-xl p-3 hover:bg-slate-700/50 transition-all">
            <span className="text-amber-400 font-bold text-sm">Appelez maintenant</span>
            <span className="text-white font-bold text-sm">581-307-5983</span>
          </a>
        </div>

      </div>
    </div>
  );
}

export default function SoumissionPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="text-amber-400 text-lg">Chargement...</div>
      </div>
    }>
      <SoumissionForm />
    </Suspense>
  );
}
