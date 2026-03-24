'use client';

import { useState, useCallback, useRef } from 'react';
import { PollingProvider } from '@/components/polling-provider';

interface PortfolioItem {
  id: number;
  titre: string;
  description: string | null;
  type_service: string;
  superficie: number | null;
  couleur: string | null;
  ville: string | null;
  photos: string[];
  videos: string[];
  featured: boolean;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  flake: 'Flocon',
  metallique: 'Métallique',
  commercial: 'Commercial',
  couleur_unie: 'Couleur unie',
  quartz: 'Quartz',
};

const TYPE_COLORS: Record<string, string> = {
  flake: 'bg-blue-600',
  metallique: 'bg-purple-600',
  commercial: 'bg-amber-600',
  couleur_unie: 'bg-green-600',
  quartz: 'bg-rose-600',
};

const SECTIONS = ['tout', 'metallique', 'flake', 'commercial', 'couleur_unie', 'quartz'] as const;

function PageContent() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [activeSection, setActiveSection] = useState<string>('tout');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [typeService, setTypeService] = useState('flake');
  const [superficie, setSuperficie] = useState('');
  const [couleur, setCouleur] = useState('');
  const [ville, setVille] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [featured, setFeatured] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/portfolio');
    const json = await res.json();
    setItems(json.data ?? []);
  }, []);

  const resetForm = () => {
    setTitre('');
    setDescription('');
    setTypeService('flake');
    setSuperficie('');
    setCouleur('');
    setVille('');
    setPhotoUrls([]);
    setPhotoPreviews([]);
    setFeatured(false);
  };

  const handlePhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Show previews immediately
    const previews: string[] = [];
    for (let i = 0; i < files.length; i++) {
      previews.push(URL.createObjectURL(files[i]));
    }
    setPhotoPreviews(prev => [...prev, ...previews]);

    // Upload
    setUploading(true);
    const form = new FormData();
    for (let i = 0; i < files.length; i++) {
      form.append('photos', files[i]);
    }

    try {
      const res = await fetch('/api/portfolio/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (data.urls) {
        setPhotoUrls(prev => [...prev, ...data.urls]);
      }
    } catch {
      // Upload failed
    }
    setUploading(false);

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = (index: number) => {
    setPhotoUrls(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titre.trim()) return;
    setSaving(true);

    await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titre: titre.trim(),
        description: description.trim() || null,
        type_service: typeService,
        superficie: superficie ? parseInt(superficie, 10) : null,
        couleur: couleur.trim() || null,
        ville: ville.trim() || null,
        photos: photoUrls,
        featured,
      }),
    });

    resetForm();
    setShowForm(false);
    setSaving(false);
    load();
  };

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Portfolio</h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            {showForm ? 'Annuler' : 'Ajouter un projet'}
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Titre *</label>
                <input
                  type="text"
                  value={titre}
                  onChange={e => setTitre(e.target.value)}
                  required
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  placeholder="Garage résidentiel Laval"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Type de service *</label>
                <select
                  value={typeService}
                  onChange={e => setTypeService(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="flake">Flocon</option>
                  <option value="metallique">Métallique</option>
                  <option value="commercial">Commercial</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Superficie (pi²)</label>
                <input
                  type="number"
                  value={superficie}
                  onChange={e => setSuperficie(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  placeholder="400"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Couleur</label>
                <input
                  type="text"
                  value={couleur}
                  onChange={e => setCouleur(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  placeholder="Gris graphite"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Ville</label>
                <input
                  type="text"
                  value={ville}
                  onChange={e => setVille(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  placeholder="Laval"
                />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={featured}
                    onChange={e => setFeatured(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-600 rounded-full peer peer-checked:bg-amber-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                </label>
                <span className="text-sm text-slate-300">Projet vedette</span>
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                placeholder="Description du projet..."
              />
            </div>

            {/* Photo upload */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Photos</label>

              {/* Preview grid */}
              {photoPreviews.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-3">
                  {photoPreviews.map((src, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={src}
                        alt={`Photo ${i + 1}`}
                        className="w-24 h-24 object-cover rounded-lg border border-slate-600"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                      >
                        x
                      </button>
                      {uploading && i >= photoUrls.length && (
                        <div className="absolute inset-0 bg-slate-900/60 rounded-lg flex items-center justify-center">
                          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotos}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 border-dashed rounded-lg px-4 py-3 text-sm text-slate-300 transition w-full justify-center disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                </svg>
                {uploading ? 'Upload en cours...' : 'Ajouter des photos'}
              </button>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving || uploading || !titre.trim()}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        )}

        {/* Section filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {SECTIONS.map(section => {
            const count = section === 'tout' ? items.length : items.filter(i => i.type_service === section).length;
            if (section !== 'tout' && count === 0) return null;
            return (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeSection === section
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                }`}
              >
                {section === 'tout' ? 'Tout' : TYPE_LABELS[section] ?? section} ({count})
              </button>
            );
          })}
        </div>

        {/* Grid */}
        {items.length === 0 && !showForm && (
          <div className="text-center py-16 text-slate-500">
            <p className="text-4xl mb-3">📸</p>
            <p className="text-sm">Aucun projet dans le portfolio</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items
            .filter(item => activeSection === 'tout' || item.type_service === activeSection)
            .map(item => (
            <div key={item.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden hover:border-slate-600 transition">
              {/* Thumbnail */}
              <div className="h-40 bg-slate-700 relative">
                {item.photos && item.photos.length > 0 ? (
                  <img
                    src={item.photos[0]}
                    alt={item.titre}
                    className="w-full h-full object-cover"
                  />
                ) : item.videos && item.videos.length > 0 ? (
                  <video
                    src={item.videos[0]}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    onMouseOver={e => (e.target as HTMLVideoElement).play()}
                    onMouseOut={e => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-500 text-4xl">
                    📷
                  </div>
                )}
                {item.featured && (
                  <span className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                    Vedette
                  </span>
                )}
                <div className="absolute bottom-2 left-2 flex gap-1">
                  {item.photos && item.photos.length > 0 && (
                    <span className="bg-slate-900/80 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
                      {item.photos.length} photo{item.photos.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {item.videos && item.videos.length > 0 && (
                    <span className="bg-blue-900/80 text-blue-200 text-[10px] font-medium px-2 py-0.5 rounded-full">
                      {item.videos.length} video{item.videos.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-white font-semibold text-sm leading-tight">{item.titre}</h3>
                  <span className={`${TYPE_COLORS[item.type_service] ?? 'bg-slate-600'} text-white text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap`}>
                    {TYPE_LABELS[item.type_service] ?? item.type_service}
                  </span>
                </div>
                {item.description && (
                  <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  {item.superficie && <span>{item.superficie} pi²</span>}
                  {item.ville && <span>{item.ville}</span>}
                  {item.couleur && <span>{item.couleur}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PollingProvider>
  );
}

export default function PortfolioPage() {
  return <PageContent />;
}
