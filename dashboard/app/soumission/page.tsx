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

  const services = [
    { value: 'Finition Flake', label: 'Flocon (Flake)', desc: 'Le plus populaire', icon: '✨' },
    { value: 'Finition Métallique', label: 'Metallique', desc: 'Effet marbre luxueux', icon: '🪞' },
    { value: 'Quartz', label: 'Quartz', desc: 'Look pierre naturelle', icon: '💎' },
    { value: 'Couleur unie', label: 'Couleur unie', desc: 'Fini lisse et uniforme', icon: '🎨' },
    { value: 'Commercial', label: 'Commercial', desc: 'Ultra-resistant', icon: '🏭' },
    { value: 'Antidérapant', label: 'Antiderapant', desc: 'Securite maximale', icon: '🦶' },
    { value: 'Meulage au diamant', label: 'Meulage', desc: 'Beton meule sans epoxy', icon: '💿' },
  ];

  const espaces = [
    { value: 'Garage', icon: '🚗' },
    { value: 'Sous-sol', icon: '🏠' },
    { value: 'Balcon', icon: '🌿' },
    { value: 'Commercial', icon: '🏢' },
    { value: 'Industriel', icon: '🏭' },
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

  const canNext = [
    () => !!form.service,
    () => !!form.type_projet,
    () => !!form.surface_estimee,
    () => !!form.nom && !!form.telephone,
    () => !!form.email && !!form.adresse && !!form.ville,
  ];

  if (done) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Merci!</h2>
          <p className="text-gray-600 mb-4">
            On vous prepare une soumission personnalisee. Vous allez recevoir un appel ou un courriel tres bientot!
          </p>
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-4">
            <p className="text-amber-800 font-bold text-lg">🏷️ 20% de rabais en avril!</p>
            <p className="text-amber-700 text-sm">Le rabais s'applique automatiquement.</p>
          </div>
          <div className="text-gray-500 text-sm space-y-1">
            <p><strong>Luca</strong> — 581-307-5983</p>
            <p><strong>Jason</strong> — 581-307-2678</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a]">
      {/* Header */}
      <div className="bg-[#0f172a] pt-6 pb-4 px-4 text-center">
        <img src="/logo-email.jpg" alt="Novus Epoxy" className="w-16 h-16 rounded-xl mx-auto mb-3" />
        <h1 className="text-amber-400 text-xl font-bold">Novus Epoxy</h1>
        <p className="text-slate-400 text-xs mt-1">Planchers epoxy haut de gamme — Quebec</p>
      </div>

      {/* Promo banner */}
      <div className="mx-4 mb-4 bg-amber-400 rounded-xl p-3 text-center">
        <p className="text-[#0f172a] font-extrabold text-lg">20% de rabais en avril!</p>
        <p className="text-[#0f172a]/70 text-xs">Soumission gratuite en moins d'une heure</p>
      </div>

      {/* Progress bar */}
      <div className="mx-4 mb-4 flex gap-1">
        {[0,1,2,3,4].map(i => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= step ? 'bg-amber-400' : 'bg-slate-700'}`} />
        ))}
      </div>

      {/* Steps */}
      <div className="px-4 pb-8">
        {/* Step 0: Service */}
        {step === 0 && (
          <div className="space-y-3">
            <h2 className="text-white text-lg font-bold">Quel type de fini?</h2>
            <div className="grid grid-cols-2 gap-2">
              {services.map(s => (
                <button
                  key={s.value}
                  onClick={() => { set('service', s.value); setStep(1); }}
                  className={`p-3 rounded-xl text-left transition-all border-2 ${
                    form.service === s.value
                      ? 'bg-amber-400/20 border-amber-400 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300 active:bg-slate-700'
                  }`}
                >
                  <span className="text-2xl">{s.icon}</span>
                  <p className="font-semibold text-sm mt-1">{s.label}</p>
                  <p className="text-xs opacity-60">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Espace */}
        {step === 1 && (
          <div className="space-y-3">
            <h2 className="text-white text-lg font-bold">C'est pour quel espace?</h2>
            <div className="grid grid-cols-2 gap-2">
              {espaces.map(e => (
                <button
                  key={e.value}
                  onClick={() => { set('type_projet', e.value); setStep(2); }}
                  className={`p-4 rounded-xl text-center transition-all border-2 ${
                    form.type_projet === e.value
                      ? 'bg-amber-400/20 border-amber-400 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300 active:bg-slate-700'
                  }`}
                >
                  <span className="text-3xl">{e.icon}</span>
                  <p className="font-semibold text-sm mt-2">{e.value}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Surface */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-white text-lg font-bold">Combien de pieds carres?</h2>
            <p className="text-slate-400 text-sm">Un approximatif, c'est correct!</p>
            <div className="grid grid-cols-3 gap-2">
              {['200', '400', '600', '800', '1000', '1500'].map(v => (
                <button
                  key={v}
                  onClick={() => set('surface_estimee', v)}
                  className={`p-3 rounded-xl font-bold transition-all border-2 ${
                    form.surface_estimee === v
                      ? 'bg-amber-400/20 border-amber-400 text-amber-400'
                      : 'bg-slate-800 border-slate-700 text-slate-300 active:bg-slate-700'
                  }`}
                >
                  {v} pi²
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                placeholder="Autre superficie..."
                value={['200','400','600','800','1000','1500'].includes(form.surface_estimee) ? '' : form.surface_estimee}
                onChange={e => set('surface_estimee', e.target.value)}
                className="flex-1 bg-slate-800 border-2 border-slate-700 text-white rounded-xl p-3 text-sm focus:border-amber-400 focus:outline-none"
              />
              <span className="text-slate-400 text-sm">pi²</span>
            </div>
            {form.surface_estimee && (
              <button onClick={() => setStep(3)} className="w-full bg-amber-400 text-[#0f172a] font-bold py-3 rounded-xl text-lg active:bg-amber-500 transition-all">
                Continuer
              </button>
            )}
          </div>
        )}

        {/* Step 3: Nom + Tel */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-white text-lg font-bold">Vos coordonnees</h2>
            <input
              type="text"
              placeholder="Nom complet"
              value={form.nom}
              onChange={e => set('nom', e.target.value)}
              autoComplete="name"
              className="w-full bg-slate-800 border-2 border-slate-700 text-white rounded-xl p-3 text-base focus:border-amber-400 focus:outline-none"
            />
            <input
              type="tel"
              inputMode="tel"
              placeholder="Telephone (ex: 581-555-1234)"
              value={form.telephone}
              onChange={e => set('telephone', e.target.value)}
              autoComplete="tel"
              className="w-full bg-slate-800 border-2 border-slate-700 text-white rounded-xl p-3 text-base focus:border-amber-400 focus:outline-none"
            />
            {form.nom && form.telephone && (
              <button onClick={() => setStep(4)} className="w-full bg-amber-400 text-[#0f172a] font-bold py-3 rounded-xl text-lg active:bg-amber-500 transition-all">
                Presque fini!
              </button>
            )}
          </div>
        )}

        {/* Step 4: Email + Adresse + Ville + Submit */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-white text-lg font-bold">Derniere etape!</h2>
            <input
              type="email"
              inputMode="email"
              placeholder="Courriel"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              autoComplete="email"
              className="w-full bg-slate-800 border-2 border-slate-700 text-white rounded-xl p-3 text-base focus:border-amber-400 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Adresse (ex: 123 rue Principale)"
              value={form.adresse}
              onChange={e => set('adresse', e.target.value)}
              autoComplete="street-address"
              className="w-full bg-slate-800 border-2 border-slate-700 text-white rounded-xl p-3 text-base focus:border-amber-400 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Ville / Secteur"
              value={form.ville}
              onChange={e => set('ville', e.target.value)}
              autoComplete="address-level2"
              className="w-full bg-slate-800 border-2 border-slate-700 text-white rounded-xl p-3 text-base focus:border-amber-400 focus:outline-none"
            />
            {form.email && form.adresse && form.ville && (
              <button
                onClick={submit}
                disabled={submitting}
                className="w-full bg-amber-400 text-[#0f172a] font-extrabold py-4 rounded-xl text-lg active:bg-amber-500 transition-all disabled:opacity-50"
              >
                {submitting ? 'Envoi en cours...' : '🚀 Envoyer ma soumission gratuite!'}
              </button>
            )}
          </div>
        )}

        {/* Back button */}
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="mt-4 text-slate-500 text-sm w-full text-center active:text-slate-300"
          >
            ← Retour
          </button>
        )}

        {/* Trust badges */}
        <div className="mt-8 text-center space-y-2">
          <div className="flex justify-center gap-4 text-xs text-slate-500">
            <span>✅ Licence RBQ</span>
            <span>✅ Garantie 10 ans</span>
          </div>
          <div className="flex justify-center gap-4 text-xs text-slate-500">
            <span>✅ +1000 projets</span>
            <span>✅ 15 ans exp.</span>
          </div>
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
