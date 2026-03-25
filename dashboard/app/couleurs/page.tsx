'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FLAKE_COLORS, PIGMENT_COLORS, SOLID_COLORS, QUARTZ_COLORS, CATEGORY_LABELS, QUARTZ_CATEGORY_LABELS, type FlakeColor, type PigmentColor, type SolidColor, type QuartzColor } from '@/lib/torginol';

type Tab = 'flake' | 'pigment' | 'solid' | 'quartz';
type AnyColor = FlakeColor | PigmentColor | SolidColor | QuartzColor;

const categories = Object.keys(CATEGORY_LABELS) as FlakeColor['category'][];

export default function CouleursPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Chargement...</div>}>
      <CouleursContent />
    </Suspense>
  );
}

function CouleursContent() {
  const searchParams = useSearchParams();
  const visitorId = searchParams.get('vid');
  const initialTab = (searchParams.get('tab') as Tab) || 'flake';
  const locked = searchParams.get('locked') === '1';

  const [tab, setTab] = useState<Tab>(['flake', 'pigment', 'solid', 'quartz'].includes(initialTab) ? initialTab : 'flake');
  const [selected, setSelected] = useState<AnyColor | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const currentColors = tab === 'flake' ? FLAKE_COLORS : tab === 'pigment' ? PIGMENT_COLORS : tab === 'quartz' ? QUARTZ_COLORS : SOLID_COLORS;
  const hasCategories = tab === 'flake' || tab === 'quartz';

  const filtered = currentColors.filter(c => {
    if (hasCategories && filter !== 'all' && 'category' in c && c.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.colors.toLowerCase().includes(q);
    }
    return true;
  });

  async function chooseColor(color: AnyColor) {
    setSending(true);

    const typeLabel = tab === 'flake' ? 'Flocon' : tab === 'pigment' ? 'Pigment' : tab === 'quartz' ? 'Quartz' : 'Couleur unie';
    const message = `J'ai choisi la couleur ${color.name} (${typeLabel})`;

    try {
      // If from chatbot, send to chat API
      if (visitorId) {
        await fetch('https://novus-epoxy.vercel.app/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, visitor_id: visitorId }),
        });
      }

      // Store the color choice so the form/widget picks it up
      try {
        localStorage.setItem('ne_color_chosen', JSON.stringify({ name: color.name, code: color.code, type: typeLabel, message, ts: Date.now() }));
      } catch {}

      setSent(color.name);
      setSelected(null);
    } catch {
      alert('Erreur — reessayez');
    } finally {
      setSending(false);
    }
  }

  const tabStyle = (t: Tab) => ({
    padding: '10px 20px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
    background: tab === t ? '#f59e0b' : '#1e293b',
    color: tab === t ? '#0f172a' : '#94a3b8',
    fontWeight: tab === t ? 700 : 400 as number, fontSize: '14px',
  });

  const tabLabels: Record<Tab, string> = {
    flake: `Flocon (${FLAKE_COLORS.length})`,
    quartz: `Quartz (${QUARTZ_COLORS.length})`,
    solid: `Couleur unie (${SOLID_COLORS.length})`,
    pigment: `Pigment (${PIGMENT_COLORS.length})`,
  };

  // Success confirmation
  if (sent) {
    const isFromForm = locked || !visitorId;
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>&#10003;</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 12px' }}>Excellent choix!</h1>
          <p style={{ color: '#94a3b8', fontSize: '16px', margin: '0 0 8px' }}>
            Vous avez choisi <strong style={{ color: '#f59e0b' }}>{sent}</strong>
          </p>
          <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 24px' }}>
            {isFromForm
              ? 'Fermez cet onglet pour retourner a votre formulaire. Votre couleur sera affichee automatiquement!'
              : 'Votre choix a ete envoye dans le chat. Retournez a la conversation pour continuer!'}
          </p>
          <button
            onClick={() => { setSent(null); }}
            style={{
              padding: '12px 24px', background: '#1e293b', color: '#f59e0b',
              border: '1px solid #f59e0b', borderRadius: '8px', fontSize: '14px',
              cursor: 'pointer', marginRight: '8px',
            }}
          >
            Choisir une autre couleur
          </button>
          <button
            onClick={() => {
              if (isFromForm) {
                // Try to close this tab — form is still open in the other tab
                // The form's focus listener will pick up the color from localStorage
                window.close();
                // Fallback if window.close() doesn't work (some browsers block it)
                setTimeout(() => {
                  window.location.href = 'https://novusepoxy.ca/#ghl-form';
                }, 300);
              } else {
                window.location.href = 'https://novusepoxy.ca?chatResume=1';
              }
            }}
            style={{
              padding: '12px 24px', background: '#f59e0b', color: '#0f172a',
              border: 'none', borderRadius: '8px', fontSize: '14px',
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            {isFromForm ? 'Retourner au formulaire' : 'Retourner au chat'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderBottom: '1px solid #334155', padding: '24px 16px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: 0 }}>
          Couleurs Novus Epoxy
        </h1>
        <p style={{ color: '#94a3b8', margin: '8px 0 0', fontSize: '14px' }}>
          {visitorId
            ? 'Cliquez sur une couleur pour la choisir!'
            : 'Choisissez la couleur parfaite pour votre projet!'}
        </p>
      </div>

      {/* Tabs — hidden when locked from form */}
      {!locked && (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px 16px 0', display: 'flex', gap: '4px', overflowX: 'auto' }}>
        {(['flake', 'quartz', 'solid', 'pigment'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setFilter('all'); setSearch(''); }} style={tabStyle(t)}>
            {tabLabels[t]}
          </button>
        ))}
      </div>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px' }}>
        {/* Empty state */}
        {currentColors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>
              {tab === 'pigment' ? '✨' : '🎨'}
            </div>
            <h2 style={{ color: '#94a3b8', margin: '0 0 8px', fontSize: '20px' }}>
              {tab === 'pigment' ? 'Couleurs Pigment' : 'Couleurs Unies'}
            </h2>
            <p style={{ fontSize: '14px' }}>
              Bientot disponible! Contactez-nous pour voir les options.
            </p>
          </div>
        ) : (
          <>
            {/* Search */}
            <input
              type="text"
              placeholder="Rechercher une couleur..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '12px 16px', borderRadius: '8px',
                background: '#1e293b', border: '1px solid #334155', color: '#f8fafc',
                fontSize: '16px', marginBottom: '12px', outline: 'none',
              }}
            />

            {/* Category filters (flake and quartz) */}
            {hasCategories && (() => {
              const catLabels = tab === 'quartz' ? QUARTZ_CATEGORY_LABELS : CATEGORY_LABELS;
              const catKeys = Object.keys(catLabels);
              const catColors = tab === 'quartz' ? QUARTZ_COLORS : FLAKE_COLORS;
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                  <button
                    onClick={() => setFilter('all')}
                    style={{
                      padding: '8px 16px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                      background: filter === 'all' ? '#f59e0b' : '#1e293b',
                      color: filter === 'all' ? '#0f172a' : '#94a3b8',
                      fontWeight: filter === 'all' ? 700 : 400, fontSize: '13px',
                    }}
                  >
                    Toutes ({catColors.length})
                  </button>
                  {catKeys.map(cat => {
                    const count = catColors.filter((c: FlakeColor | QuartzColor) => c.category === cat).length;
                    if (count === 0) return null;
                    return (
                      <button
                        key={cat}
                        onClick={() => setFilter(cat)}
                        style={{
                          padding: '8px 16px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                          background: filter === cat ? '#f59e0b' : '#1e293b',
                          color: filter === cat ? '#0f172a' : '#94a3b8',
                          fontWeight: filter === cat ? 700 : 400, fontSize: '13px',
                        }}
                      >
                        {(catLabels as Record<string, string>)[cat]} ({count})
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Color Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '12px',
            }}>
              {filtered.map(color => (
                <div
                  key={color.name}
                  onClick={() => setSelected(color)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    background: '#1e293b',
                    border: selected?.name === color.name ? '2px solid #f59e0b' : '2px solid transparent',
                    transition: 'all 0.2s',
                  }}
                >
                  {'image' in color && color.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={color.image}
                      alt={color.name}
                      style={{
                        width: '100%', height: '120px',
                        objectFit: 'cover',
                        borderRadius: '10px 10px 0 0',
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '120px',
                      background: color.hex,
                      borderRadius: '10px 10px 0 0',
                    }} />
                  )}
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>{color.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{color.code}</div>
                  </div>
                </div>
              ))}
            </div>

            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                Aucune couleur trouvee
              </div>
            )}
          </>
        )}
      </div>

      {/* Selected color modal */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: '16px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1e293b', borderRadius: '16px', maxWidth: '400px',
              width: '100%', overflow: 'hidden',
            }}
          >
            {'image' in selected && selected.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.image}
                alt={selected.name}
                style={{ width: '100%', height: '200px', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ width: '100%', height: '200px', background: selected.hex }} />
            )}
            <div style={{ padding: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>{selected.name}</h2>
              <p style={{ color: '#64748b', margin: '4px 0 0', fontSize: '13px' }}>Code: {selected.code}</p>
              <p style={{ color: '#94a3b8', margin: '12px 0 0', fontSize: '14px' }}>{selected.colors}</p>
              {'category' in selected && (
                <p style={{ color: '#64748b', margin: '8px 0 0', fontSize: '12px' }}>
                  Categorie: {tab === 'quartz'
                    ? QUARTZ_CATEGORY_LABELS[(selected as QuartzColor).category]
                    : CATEGORY_LABELS[(selected as FlakeColor).category]}
                </p>
              )}

              {/* Choose button */}
              <button
                onClick={() => chooseColor(selected)}
                disabled={sending}
                style={{
                  marginTop: '16px', width: '100%', padding: '14px',
                  background: '#f59e0b', color: '#0f172a', border: 'none',
                  borderRadius: '8px', fontSize: '16px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {sending ? 'Envoi...' : 'Choisir cette couleur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
