'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SoumissionForm() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [longueur, setLongueur] = useState('');
  const [largeur, setLargeur] = useState('');
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

  const services = [
    { value: 'Finition Flake', label: 'Flocon (Flake)', desc: 'Le plus populaire', img: '/portfolio/flake-1.jpg' },
    { value: 'Finition Metallique', label: 'Metallique', desc: 'Effet marbre luxueux', img: '/portfolio/metallic-1.jpg' },
    { value: 'Quartz', label: 'Quartz', desc: 'Pierre naturelle', img: '/portfolio/quartz-1.jpg' },
    { value: 'Couleur unie', label: 'Couleur unie', desc: 'Fini lisse uniforme', img: '/portfolio/uni-1.jpg' },
    { value: 'Commercial', label: 'Commercial', desc: 'Ultra-resistant', img: '/portfolio/commercial-1.jpg' },
    { value: 'Antiderapant', label: 'Antiderapant', desc: 'Securite maximale', img: '/portfolio/anti-1.jpg' },
  ];

  const espaces = [
    { value: 'Garage', icon: '🚗', desc: 'Plancher de garage' },
    { value: 'Sous-sol', icon: '🏠', desc: 'Espace de vie' },
    { value: 'Balcon', icon: '🌿', desc: 'Terrasse / balcon' },
    { value: 'Commercial', icon: '🏢', desc: 'Bureau / commerce' },
    { value: 'Industriel', icon: '🏭', desc: 'Entrepot / atelier' },
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

  // Step labels for progress
  const stepLabels = ['Fini', 'Espace', 'Surface', 'Vous', 'Contact'];

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
              <p className="text-amber-400 font-bold text-xl mb-1">20% de rabais applique!</p>
              <p className="text-amber-400/60 text-sm">Offre valide jusqu'au 30 avril 2026</p>
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

        {/* Promo banner */}
        <div className="mx-4 mb-4">
          <div className="bg-gradient-to-r from-amber-400 to-amber-500 rounded-2xl p-4 text-center shadow-lg shadow-amber-400/20">
            <p className="text-[#0f172a] font-extrabold text-xl leading-tight">Soumission gratuite</p>
            <p className="text-[#0f172a]/80 font-bold text-sm mt-1">+ consultation sur place — Places limitees</p>
            <div className="mt-2 inline-block bg-[#0f172a]/15 rounded-lg px-3 py-1">
              <p className="text-[#0f172a] font-extrabold text-sm">🔥 20% de rabais en avril</p>
            </div>
          </div>
        </div>

        {/* Progress bar with labels */}
        <div className="mx-4 mb-5">
          <div className="flex gap-1 mb-1.5">
            {[0,1,2,3,4].map(i => (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= step ? 'bg-amber-400' : 'bg-slate-700/50'}`} />
            ))}
          </div>
          <div className="flex justify-between px-1">
            {stepLabels.map((label, i) => (
              <span key={label} className={`text-[10px] transition-all ${i <= step ? 'text-amber-400/80' : 'text-slate-600'}`}>{label}</span>
            ))}
          </div>
        </div>

        {/* Card container */}
        <div className="mx-4 mb-6">
          <div className="bg-[#1e293b]/80 backdrop-blur border border-slate-700/50 rounded-2xl p-5 shadow-xl min-h-[300px]">

            {/* Step 0: Service */}
            {step === 0 && (
              <div>
                <h2 className="text-white text-xl font-bold mb-1">Quel type de fini?</h2>
                <p className="text-slate-400 text-sm mb-4">Choisissez le style qui vous plait</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {services.map(s => (
                    <button
                      key={s.value}
                      onClick={() => { set('service', s.value); setStep(1); }}
                      className="group relative overflow-hidden rounded-xl border-2 border-slate-600/50 hover:border-amber-400/60 active:border-amber-400 transition-all text-left"
                    >
                      <div className="bg-gradient-to-br from-slate-700/80 to-slate-800 p-3.5">
                        <p className="font-bold text-white text-sm group-hover:text-amber-400 transition-colors">{s.label}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{s.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1: Espace */}
            {step === 1 && (
              <div>
                <h2 className="text-white text-xl font-bold mb-1">C'est pour quel espace?</h2>
                <p className="text-slate-400 text-sm mb-4">Selectionnez le type d'espace</p>
                <div className="space-y-2">
                  {espaces.map(e => (
                    <button
                      key={e.value}
                      onClick={() => { set('type_projet', e.value); setStep(2); }}
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

            {/* Step 2: Surface */}
            {step === 2 && (
              <div>
                <h2 className="text-white text-xl font-bold mb-1">Dimensions du plancher</h2>
                <p className="text-slate-400 text-sm mb-5">Entrez les mesures OU directement les pi²</p>

                {/* Option A: Dimensions longueur x largeur */}
                <div className="bg-slate-900/60 border-2 border-slate-700 rounded-xl p-4 mb-3">
                  <p className="text-amber-400 text-xs font-bold mb-2 uppercase tracking-wider">Option 1 — Mesures en pieds</p>
                  <p className="text-slate-400 text-[11px] mb-3">On calcule les pi² pour vous</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="text-slate-500 text-[10px] font-medium mb-1 block text-center">Longueur</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="20"
                        value={longueur}
                        onChange={e => {
                          const val = e.target.value;
                          setLongueur(val);
                          const l = parseFloat(val);
                          const w = parseFloat(largeur);
                          if (!isNaN(l) && !isNaN(w) && l > 0 && w > 0) set('surface_estimee', Math.round(l * w).toString());
                          else if (!val && !largeur) set('surface_estimee', '');
                        }}
                        className="w-full bg-slate-800/70 border-2 border-slate-600/50 text-white rounded-lg p-3 text-lg font-bold focus:border-amber-400 focus:outline-none text-center placeholder:text-slate-600"
                      />
                    </div>
                    <span className="text-amber-400 font-bold text-2xl pt-5">×</span>
                    <div className="flex-1">
                      <label className="text-slate-500 text-[10px] font-medium mb-1 block text-center">Largeur</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="24"
                        value={largeur}
                        onChange={e => {
                          const val = e.target.value;
                          setLargeur(val);
                          const l = parseFloat(longueur);
                          const w = parseFloat(val);
                          if (!isNaN(l) && !isNaN(w) && l > 0 && w > 0) set('surface_estimee', Math.round(l * w).toString());
                          else if (!val && !longueur) set('surface_estimee', '');
                        }}
                        className="w-full bg-slate-800/70 border-2 border-slate-600/50 text-white rounded-lg p-3 text-lg font-bold focus:border-amber-400 focus:outline-none text-center placeholder:text-slate-600"
                      />
                    </div>
                  </div>
                  {longueur && largeur && form.surface_estimee && (
                    <div className="mt-3 text-center">
                      <div className="inline-block bg-amber-400/15 border border-amber-400/40 rounded-lg px-4 py-1.5">
                        <span className="text-amber-400 font-extrabold text-lg">= {form.surface_estimee} pi²</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* OU separator */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-700"></div>
                  <span className="text-slate-500 text-xs font-bold">OU</span>
                  <div className="flex-1 h-px bg-slate-700"></div>
                </div>

                {/* Option B: Superficie exacte */}
                <div className="bg-slate-900/60 border-2 border-slate-700 rounded-xl p-4 mb-4">
                  <p className="text-amber-400 text-xs font-bold mb-2 uppercase tracking-wider">Option 2 — Superficie exacte</p>
                  <p className="text-slate-400 text-[11px] mb-3">Si vous connaissez deja vos pi²</p>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="Ex: 475"
                      value={longueur === '' && largeur === '' ? form.surface_estimee : ''}
                      onChange={e => {
                        setLongueur('');
                        setLargeur('');
                        set('surface_estimee', e.target.value);
                      }}
                      className="w-full bg-slate-800/70 border-2 border-slate-600/50 text-white rounded-lg p-3 pr-14 text-lg font-bold focus:border-amber-400 focus:outline-none text-center placeholder:text-slate-600"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-amber-400 font-bold text-sm">pi²</span>
                  </div>
                </div>

                {form.surface_estimee && Number(form.surface_estimee) > 0 && (
                  <button onClick={() => setStep(3)} className="w-full bg-gradient-to-r from-amber-400 to-amber-500 text-[#0f172a] font-bold py-3.5 rounded-xl text-lg hover:from-amber-500 hover:to-amber-600 active:from-amber-600 active:to-amber-700 transition-all shadow-lg shadow-amber-400/20">
                    Continuer →
                  </button>
                )}
              </div>
            )}

            {/* Step 3: Nom + Tel */}
            {step === 3 && (
              <div>
                <h2 className="text-white text-xl font-bold mb-1">Vos coordonnees</h2>
                <p className="text-slate-400 text-sm mb-4">Pour vous contacter avec votre soumission</p>
                <div className="space-y-3">
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
                {form.nom && form.telephone && (
                  <button onClick={() => setStep(4)} className="w-full mt-4 bg-gradient-to-r from-amber-400 to-amber-500 text-[#0f172a] font-bold py-3.5 rounded-xl text-lg hover:from-amber-500 hover:to-amber-600 active:from-amber-600 active:to-amber-700 transition-all shadow-lg shadow-amber-400/20">
                    Presque fini! →
                  </button>
                )}
              </div>
            )}

            {/* Step 4: Email + Adresse + Ville + Submit */}
            {step === 4 && (
              <div>
                <h2 className="text-white text-xl font-bold mb-1">Derniere etape!</h2>
                <p className="text-slate-400 text-sm mb-4">On y est presque, {form.nom.split(' ')[0]}</p>
                <div className="space-y-3">
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
                  <div>
                    <label className="text-slate-400 text-xs font-medium mb-1 block">Adresse des travaux *</label>
                    <input
                      type="text"
                      placeholder="123 rue Exemple, Quebec"
                      value={form.adresse}
                      onChange={e => set('adresse', e.target.value)}
                      autoComplete="street-address"
                      className="w-full bg-slate-800/50 border-2 border-slate-600/50 text-white rounded-xl p-3.5 text-base focus:border-amber-400 focus:outline-none transition-all placeholder:text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs font-medium mb-1 block">Ville / Secteur *</label>
                    <input
                      type="text"
                      placeholder="Quebec, Levis, Beauport..."
                      value={form.ville}
                      onChange={e => set('ville', e.target.value)}
                      autoComplete="address-level2"
                      className="w-full bg-slate-800/50 border-2 border-slate-600/50 text-white rounded-xl p-3.5 text-base focus:border-amber-400 focus:outline-none transition-all placeholder:text-slate-600"
                    />
                  </div>
                </div>
                {form.email && form.adresse && form.ville && (
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
          <a href="tel:5813072678" className="flex items-center justify-center gap-2 bg-slate-800/50 border border-slate-700/30 rounded-xl p-3 hover:bg-slate-700/50 transition-all">
            <span className="text-amber-400 font-bold text-sm">Appelez maintenant</span>
            <span className="text-white font-bold text-sm">581-307-2678</span>
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
