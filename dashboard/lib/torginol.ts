// Torginol Flake Color Catalog for Novus Epoxy
// Complete catalog from torginol.com Flake Flooring product line

export interface FlakeColor {
  name: string;
  code: string;
  colors: string; // description des couleurs principales
  category: 'neutre' | 'terre' | 'bleu' | 'vert' | 'brun' | 'rouge' | 'sombre';
  // CSS-approximate hex for swatch background
  hex: string;
  // Path to real photo (e.g. '/colors/sand-dollar.webp')
  image?: string;
}

export const FLAKE_COLORS: FlakeColor[] = [
  // Neutres — gris, blanc, noir
  { name: 'Sand Dollar', code: 'FB-951', colors: 'beige pale, blanc, gris clair', category: 'neutre', hex: '#c9c0b3', image: '/colors/sand-dollar.webp' },
  { name: 'Opal', code: 'FB-901', colors: 'gris perle, blanc, beige', category: 'neutre', hex: '#b8b0a5', image: '/colors/opal.webp' },
  { name: 'Siberian', code: 'FB-902', colors: 'gris clair, blanc, touches beige', category: 'neutre', hex: '#b5afa6', image: '/colors/siberian.webp' },
  { name: 'Glacial', code: 'FB-940', colors: 'gris bleu pale, blanc, argent', category: 'neutre', hex: '#a8adb0', image: '/colors/glacial.webp' },
  { name: 'Birch Bark', code: 'FB-1005', colors: 'blanc casse, gris clair, beige', category: 'neutre', hex: '#c5bfb5', image: '/colors/birch-bark.webp' },
  { name: 'Victorian', code: 'FB-818', colors: 'gris moyen, blanc, charcoal', category: 'neutre', hex: '#8e8b87', image: '/colors/victorian.webp' },
  { name: 'Colonial', code: 'FB-817', colors: 'gris bleu, blanc, charcoal', category: 'neutre', hex: '#7d8085', image: '/colors/colonial.webp' },
  { name: 'Suave', code: 'FB-920', colors: 'beige, gris, blanc creme', category: 'neutre', hex: '#a8a098', image: '/colors/suave.webp' },
  { name: 'Cannoli', code: 'FB-130', colors: 'creme, beige pale, blanc', category: 'neutre', hex: '#c2b9ad', image: '/colors/cannoli.webp' },
  { name: 'Sea Crest', code: 'FB-803', colors: 'gris vert pale, blanc, argent', category: 'neutre', hex: '#969e98', image: '/colors/sea-crest.webp' },
  { name: 'Feather Gray', code: 'FB-905', colors: 'gris doux, blanc, argent', category: 'neutre', hex: '#9a9590', image: '/colors/feather-gray.webp' },
  { name: 'Quicksilver', code: 'FB-424', colors: 'argent, gris pale, blanc', category: 'neutre', hex: '#929396', image: '/colors/quicksilver.webp' },
  { name: 'Nimbus', code: 'FB-927', colors: 'gris nuage, blanc, charcoal', category: 'neutre', hex: '#8a8d90', image: '/colors/nimbus.webp' },
  { name: 'Blizzard', code: 'FB-6001', colors: 'blanc, gris pale, argent', category: 'neutre', hex: '#b5b8b5', image: '/colors/blizzard.webp' },
  { name: 'Arctic', code: 'FB-704', colors: 'blanc gris, argent, gris clair', category: 'neutre', hex: '#a3a5a0', image: '/colors/arctic.webp' },
  { name: 'Snowfall', code: 'FB-602', colors: 'blanc, gris tres pale, argent', category: 'neutre', hex: '#bbbdb8', image: '/colors/snowfall.webp' },
  { name: 'Sea Mist', code: 'FB-805', colors: 'gris vert, blanc, argent', category: 'neutre', hex: '#929b95', image: '/colors/sea-mist.webp' },
  { name: 'Stony Creek', code: 'FB-806', colors: 'gris pierre, brun, blanc', category: 'neutre', hex: '#8a8580', image: '/colors/stony-creek.webp' },
  { name: 'Morning Dew', code: 'FB-609', colors: 'gris clair, blanc, vert pale', category: 'neutre', hex: '#9a9d95', image: '/colors/morning-dew.webp' },
  { name: 'Magnolia', code: 'FB-942', colors: 'blanc chaud, beige, gris', category: 'neutre', hex: '#b0a89e', image: '/colors/magnolia.webp' },
  { name: 'Stargazer', code: 'FB-908', colors: 'gris moyen, bleu, blanc', category: 'neutre', hex: '#7e8288', image: '/colors/stargazer.webp' },
  { name: 'Wild Dove', code: 'FB-911', colors: 'gris colombe, blanc, charcoal', category: 'neutre', hex: '#8a8885', image: '/colors/wild-dove.webp' },
  { name: 'Summit', code: 'FB-721', colors: 'gris, brun, blanc', category: 'neutre', hex: '#8a8580', image: '/colors/summit.webp' },
  { name: 'Avalanche', code: 'FB-722', colors: 'gris clair, blanc, charcoal', category: 'neutre', hex: '#9a9895', image: '/colors/avalanche.webp' },
  { name: 'Pumice', code: 'FS303', colors: 'gris beige, blanc, brun pale', category: 'neutre', hex: '#a09a90', image: '/colors/pumice.webp' },
  { name: 'Gravel', code: 'FB-414', colors: 'gris, brun, charcoal', category: 'neutre', hex: '#807d78', image: '/colors/gravel.webp' },

  // Terre — brun, beige, sable, caramel
  { name: 'Prairie', code: 'FB-529', colors: 'brun sable, beige, creme', category: 'terre', hex: '#a09080', image: '/colors/prairie.webp' },
  { name: 'Citrine', code: 'FB-978', colors: 'brun dore, beige, caramel', category: 'terre', hex: '#9a8570', image: '/colors/citrine.webp' },
  { name: 'Steelcut', code: 'FB-720', colors: 'brun gris, beige, charcoal', category: 'terre', hex: '#8a8078', image: '/colors/steelcut.webp' },
  { name: 'Cabin Fever', code: 'FB-127', colors: 'brun chaud, beige, creme', category: 'terre', hex: '#9a8570', image: '/colors/cabin-fever.webp' },
  { name: 'Anvil', code: 'FB-726', colors: 'gris brun, charcoal, beige', category: 'terre', hex: '#7d7570', image: '/colors/anvil.webp' },
  { name: 'Chickadee', code: 'FB-967', colors: 'brun, beige, noir', category: 'terre', hex: '#8a7565', image: '/colors/chickadee.webp' },
  { name: 'Coyote', code: 'FB-513', colors: 'brun sable, beige, caramel', category: 'terre', hex: '#9a8570', image: '/colors/coyote.webp' },
  { name: 'Gracious', code: 'FB-016', colors: 'beige chaud, brun, creme', category: 'terre', hex: '#b0a090', image: '/colors/gracious.webp' },
  { name: 'Shoreline', code: 'FB-421', colors: 'sable, brun clair, blanc', category: 'terre', hex: '#a89888', image: '/colors/shoreline.webp' },
  { name: 'Bambi', code: 'FB-959', colors: 'brun faon, beige, creme', category: 'terre', hex: '#a08e78', image: '/colors/bambi.webp' },
  { name: 'Stonehenge', code: 'FB-427', colors: 'gris pierre, brun, beige', category: 'terre', hex: '#8a8278', image: '/colors/stonehenge.webp' },
  { name: 'Reed', code: 'FB-507', colors: 'brun vert, beige, olive', category: 'terre', hex: '#8a8068', image: '/colors/reed.webp' },
  { name: 'Outback', code: 'FB-517', colors: 'brun rouge, sable, terre cuite', category: 'terre', hex: '#9a7560', image: '/colors/outback.webp' },
  { name: 'Talus', code: 'FS919', colors: 'brun gris, beige, charcoal', category: 'terre', hex: '#8a7d70', image: '/colors/talus.webp' },
  { name: 'Waxwing', code: 'FB-968', colors: 'brun roux, beige, sable', category: 'terre', hex: '#9a7a60', image: '/colors/waxwing.webp' },
  { name: 'Splitie', code: 'FS313', colors: 'brun, beige, gris', category: 'terre', hex: '#8a7d70', image: '/colors/splitie.webp' },
  { name: 'Thyme', code: 'FB-977', colors: 'brun olive, beige, vert', category: 'terre', hex: '#8a8068', image: '/colors/thyme.webp' },
  { name: 'Timberwolf', code: 'FB-909', colors: 'gris brun, beige, charcoal', category: 'terre', hex: '#807870', image: '/colors/timberwolf.webp' },
  { name: 'Sable', code: 'FS005', colors: 'brun sable, beige, caramel', category: 'terre', hex: '#9a8570', image: '/colors/sable.webp' },
  { name: 'Caraway', code: 'FB-510', colors: 'brun epice, beige, creme', category: 'terre', hex: '#8a7560', image: '/colors/caraway.webp' },
  { name: 'Capricorn', code: 'FB-818', colors: 'brun gris, beige, charcoal', category: 'terre', hex: '#807568', image: '/colors/capricorn.webp' },
  { name: 'Madras', code: 'FB-706', colors: 'brun chaud, sable, caramel', category: 'terre', hex: '#9a7e60', image: '/colors/madras.webp' },
  { name: 'Oasis', code: 'FB-712', colors: 'brun dore, sable, beige', category: 'terre', hex: '#a08868', image: '/colors/oasis.webp' },
  { name: 'Polar', code: 'FB-330', colors: 'gris pale, brun, blanc', category: 'terre', hex: '#a09890', image: '/colors/polar.webp' },
  { name: 'Wren', code: 'FB-970', colors: 'brun, gris, beige', category: 'terre', hex: '#8a7d70', image: '/colors/wren.webp' },
  { name: 'Loon', code: 'FB-966', colors: 'brun fonce, gris, beige', category: 'terre', hex: '#7a6d60', image: '/colors/loon.webp' },
  { name: 'Safari', code: 'FB-504', colors: 'brun safari, sable, beige', category: 'terre', hex: '#9a8268', image: '/colors/safari.webp' },
  { name: 'Sedum', code: 'FB-931', colors: 'brun vert, beige, olive', category: 'terre', hex: '#8a7d65', image: '/colors/sedum.webp' },
  { name: 'Creekbed', code: 'FB-716', colors: 'brun pierre, gris, sable', category: 'terre', hex: '#8a7d70', image: '/colors/creekbed.webp' },
  { name: 'Mushroom', code: 'FB-714', colors: 'brun champignon, gris, beige', category: 'terre', hex: '#8a8078', image: '/colors/mushroom.webp' },

  // Vert — tons verts, foret
  { name: 'Soapstone', code: 'FS320', colors: 'vert sauge, blanc, gris', category: 'vert', hex: '#8a9a80', image: '/colors/soapstone.webp' },
  { name: 'Sprout', code: 'FB-938', colors: 'vert vif, orange, blanc', category: 'vert', hex: '#7a9a60', image: '/colors/sprout.webp' },
  { name: 'Slalom', code: 'FB-927', colors: 'vert foret, blanc, gris', category: 'vert', hex: '#6a8a60', image: '/colors/slalom.webp' },
  { name: 'Juniper', code: 'FB-927', colors: 'vert bleu, gris, blanc', category: 'vert', hex: '#607a68', image: '/colors/juniper.webp' },
  { name: 'Nordic Green', code: 'FB-514', colors: 'vert nordique, blanc, gris', category: 'vert', hex: '#5a7a58', image: '/colors/nordic-green.webp' },
  { name: 'Aviator', code: 'FB-430', colors: 'vert militaire, brun, gris', category: 'vert', hex: '#5a6a50', image: '/colors/aviator.webp' },

  // Bleu — tons bleus, ocean
  { name: 'Mercury', code: 'FB-938', colors: 'gris bleu, blanc, argent', category: 'bleu', hex: '#7a8590', image: '/colors/mercury.webp' },
  { name: 'Tidal Wave', code: 'FB-807', colors: 'bleu gris, blanc, ardoise', category: 'bleu', hex: '#6a7a88', image: '/colors/tidal-wave.webp' },
  { name: 'Rapids', code: 'FB-506', colors: 'bleu, gris, blanc', category: 'bleu', hex: '#5a6a80', image: '/colors/rapids.webp' },
  { name: 'Lunar', code: 'FB-604', colors: 'gris bleu, blanc, charcoal', category: 'bleu', hex: '#6a7080', image: '/colors/lunar.webp' },
  { name: 'Rocky Ridge', code: 'FB-801', colors: 'bleu ardoise, gris, brun', category: 'bleu', hex: '#5a6570', image: '/colors/rocky-ridge.webp' },
  { name: 'Lapis', code: 'FB-963', colors: 'bleu lapis, gris, blanc', category: 'bleu', hex: '#4a5a78', image: '/colors/lapis.webp' },
  { name: 'Celestial', code: 'FB-926', colors: 'bleu celeste, gris, blanc', category: 'bleu', hex: '#5a6a80', image: '/colors/celestial.webp' },
  { name: 'Smokey Blue', code: 'FB-933', colors: 'bleu fume, gris, charcoal', category: 'bleu', hex: '#4a5568', image: '/colors/smokey-blue.webp' },
  { name: 'Current', code: 'FB-528', colors: 'bleu courant, gris, noir', category: 'bleu', hex: '#4a5a70', image: '/colors/current.webp' },

  // Rouge / cuivre — tons chauds vifs
  { name: 'Magma', code: 'FB-932', colors: 'rouge, orange, noir', category: 'rouge', hex: '#8a3a30', image: '/colors/magma.webp' },
  { name: 'Rosy-Finch', code: 'FB-969', colors: 'rose brun, gris, beige', category: 'rouge', hex: '#8a6a68', image: '/colors/rosy-finch.webp' },
  { name: 'Robin', code: 'FB-973', colors: 'brun rouge, gris, beige', category: 'rouge', hex: '#7a5a50', image: '/colors/robin.webp' },
  { name: 'Fig', code: 'FB-948', colors: 'violet brun, gris, charcoal', category: 'rouge', hex: '#6a4a48', image: '/colors/fig.webp' },
  { name: 'Feldspar', code: 'FS203', colors: 'rouge brique, brun, beige', category: 'rouge', hex: '#8a5540', image: '/colors/feldspar.webp' },
  { name: 'Crossbow', code: 'FB-520', colors: 'brun rouge, gris, charcoal', category: 'rouge', hex: '#6a4a40', image: '/colors/crossbow.webp' },

  // Sombre — noir, charcoal, fonce
  { name: 'Nightfall', code: 'FB-715', colors: 'noir, brun fonce, charcoal', category: 'sombre', hex: '#3a3530', image: '/colors/nightfall.webp' },
  { name: 'Kismet', code: 'FB-945', colors: 'brun fonce, noir, cuivre', category: 'sombre', hex: '#4a3a30', image: '/colors/kismet.webp' },
  { name: 'Quail', code: 'FB-974', colors: 'brun fonce, gris, charcoal', category: 'sombre', hex: '#4a4038', image: '/colors/quail.webp' },
  { name: 'Sparrow', code: 'FB-972', colors: 'gris fonce, brun, noir', category: 'sombre', hex: '#4a4540', image: '/colors/sparrow.webp' },
  { name: 'Cast Iron', code: 'FB-925', colors: 'noir, gris fonce, charcoal', category: 'sombre', hex: '#3a3838', image: '/colors/cast-iron.webp' },
  { name: 'Rainstorm', code: 'FB-944', colors: 'gris orage, bleu fonce, noir', category: 'sombre', hex: '#3a4048', image: '/colors/rainstorm.webp' },
  { name: 'Moose', code: 'FB-924', colors: 'brun fonce, charcoal, noir', category: 'sombre', hex: '#4a4038', image: '/colors/moose.webp' },
  { name: 'Chicory', code: 'FB-947', colors: 'bleu fonce, gris, noir', category: 'sombre', hex: '#3a4048', image: '/colors/chicory.webp' },
  { name: 'Woodpecker', code: 'FB-975', colors: 'brun fonce, charcoal, gris', category: 'sombre', hex: '#4a4038', image: '/colors/woodpecker.webp' },
  { name: 'Full Moon', code: 'FB-917', colors: 'gris fonce, blanc, noir', category: 'sombre', hex: '#4a4a4a', image: '/colors/full-moon.webp' },
  { name: 'Black Ice', code: 'FB-934', colors: 'noir, bleu fonce, charcoal', category: 'sombre', hex: '#2a2a30', image: '/colors/black-ice.webp' },
  { name: 'Raven', code: 'FB-915', colors: 'noir, gris fonce, charcoal', category: 'sombre', hex: '#2a2a28', image: '/colors/raven.webp' },
  { name: 'Carbon', code: 'FS202', colors: 'noir, gris graphite, charcoal', category: 'sombre', hex: '#252525', image: '/colors/carbon.webp' },
  { name: 'Chenille', code: 'FB-981', colors: 'gris charcoal, noir, brun', category: 'sombre', hex: '#3a3838', image: '/colors/chenille.webp' },
  { name: 'Gargoyle', code: 'FB-918', colors: 'gris fonce, bleu, noir', category: 'sombre', hex: '#3a3d42', image: '/colors/gargoyle.webp' },
  { name: 'Obsidian', code: 'FS304', colors: 'noir, gris fonce, charcoal', category: 'sombre', hex: '#2a2a2a', image: '/colors/obsidian.webp' },
  { name: 'Dolerite', code: 'FS311', colors: 'gris fonce, noir, bleu', category: 'sombre', hex: '#35383d', image: '/colors/dolerite.webp' },
  { name: 'Garnet', code: 'FS305', colors: 'gris charcoal, brun, noir', category: 'sombre', hex: '#3a3535', image: '/colors/garnet.webp' },
  { name: 'Merino', code: 'FB-971', colors: 'gris brun fonce, charcoal', category: 'sombre', hex: '#4a4540', image: '/colors/merino.webp' },
  { name: 'Burrow', code: 'FB-723', colors: 'brun fonce, gris, charcoal', category: 'sombre', hex: '#4a3d35', image: '/colors/burrow.webp' },
  { name: 'Koala', code: 'FB-811', colors: 'gris brun, charcoal, noir', category: 'sombre', hex: '#4a4540', image: '/colors/koala.webp' },
  { name: 'Java', code: 'FB-523', colors: 'brun cafe fonce, noir', category: 'sombre', hex: '#3a3028', image: '/colors/java.webp' },
  { name: 'Fog', code: 'FB-703', colors: 'gris fonce, bleu, charcoal', category: 'sombre', hex: '#4a4d52', image: '/colors/fog.webp' },
  { name: 'Frostbite', code: 'FB-930', colors: 'gris bleu fonce, noir, blanc', category: 'sombre', hex: '#3a4048', image: '/colors/frostbite.webp' },
  { name: 'Voltage', code: 'FB-946', colors: 'bleu fonce, gris, noir', category: 'sombre', hex: '#35404a', image: '/colors/voltage.webp' },
  { name: 'Houndstooth', code: 'FB-510', colors: 'noir, blanc, gris contraste', category: 'sombre', hex: '#4a4a4a', image: '/colors/houndstooth.webp' },
  { name: 'Dovetail', code: 'FB-823', colors: 'gris, brun, charcoal', category: 'sombre', hex: '#5a5550', image: '/colors/dovetail.webp' },
  { name: 'Sycamore', code: 'FB-6002', colors: 'gris brun, charcoal, beige', category: 'sombre', hex: '#5a5548', image: '/colors/sycamore.webp' },
  { name: 'Buffalo', code: 'FB-956', colors: 'brun fonce, gris, noir', category: 'sombre', hex: '#4a4038', image: '/colors/buffalo.webp' },

  // Autres
  { name: 'Swan', code: 'FB-612', colors: 'blanc, gris pale, vert', category: 'vert', hex: '#a0aa98', image: '/colors/swan.webp' },
  { name: 'Woven', code: 'FB-919', colors: 'beige, gris, brun', category: 'terre', hex: '#9a9088', image: '/colors/woven.webp' },
  { name: 'Moon Mist', code: 'FB-906', colors: 'gris pale, blanc, bleu', category: 'neutre', hex: '#9a9d98', image: '/colors/moon-mist.webp' },
  { name: 'Bramble', code: 'FB-941', colors: 'brun, vert, gris', category: 'vert', hex: '#6a7a60', image: '/colors/bramble.webp' },
  { name: 'Water Lily', code: 'FB-321', colors: 'vert eau, blanc, gris', category: 'vert', hex: '#7a9a88', image: '/colors/water-lily.webp' },
  { name: 'Stinger', code: 'FB-506', colors: 'jaune vert, brun, gris', category: 'vert', hex: '#8a9a60', image: '/colors/stinger.webp' },
  { name: 'Silver Bells', code: 'FB-903', colors: 'argent, blanc, gris', category: 'neutre', hex: '#a5a8a5', image: '/colors/silver-bells.webp' },
  { name: 'Trailmix', code: 'FB-613', colors: 'brun, beige, vert', category: 'terre', hex: '#8a8068', image: '/colors/trailmix.webp' },
  { name: 'Arkose', code: 'FS318', colors: 'gris rose, beige, brun', category: 'terre', hex: '#9a8a80', image: '/colors/arkose.webp' },
  { name: 'Submarine', code: 'FB-608', colors: 'vert fonce, gris, noir', category: 'vert', hex: '#4a5a48', image: '/colors/submarine.webp' },
  { name: 'Schist', code: 'FB-415', colors: 'gris ardoise, brun, charcoal', category: 'sombre', hex: '#5a5550', image: '/colors/schist.webp' },
  { name: 'Cardamom', code: 'FB-508', colors: 'brun epice, vert, beige', category: 'terre', hex: '#7a7058', image: '/colors/cardamom.webp' },
  { name: 'Galaxy', code: 'FB-807', colors: 'bleu fonce, gris, blanc', category: 'bleu', hex: '#4a5568', image: '/colors/galaxy.webp' },
  { name: 'Comet', code: 'FB-711', colors: 'gris bleu, brun, charcoal', category: 'bleu', hex: '#5a6068', image: '/colors/comet.webp' },
  { name: 'Domino', code: 'FB-411', colors: 'noir, blanc, gris contraste', category: 'sombre', hex: '#4a4a4a', image: '/colors/domino.webp' },
  { name: 'Dingo', code: 'FB-980', colors: 'brun, gris, charcoal', category: 'terre', hex: '#7a6d60', image: '/colors/dingo.webp' },
];

export function getColorsByCategory(category: FlakeColor['category']): FlakeColor[] {
  return FLAKE_COLORS.filter(c => c.category === category);
}

export function searchColors(query: string): FlakeColor[] {
  const q = query.toLowerCase();
  return FLAKE_COLORS.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.colors.toLowerCase().includes(q) ||
    c.category.toLowerCase().includes(q)
  );
}

export const CATEGORY_LABELS: Record<string, string> = {
  neutre: 'Neutres',
  terre: 'Tons Terre',
  bleu: 'Bleus & Ocean',
  vert: 'Verts & Nature',
  brun: 'Bruns Chauds',
  rouge: 'Rouges & Cuivres',
  sombre: 'Sombres & Fonces',
};

export function getColorCatalogText(): string {
  let text = '';
  for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
    const colors = FLAKE_COLORS.filter(c => c.category === cat);
    if (colors.length === 0) continue;
    text += `\n${label}:\n`;
    text += colors.map(c => `- ${c.name}: ${c.colors}`).join('\n');
  }
  return text;
}

// --- Pigment Colors (Metallique) ---
export interface PigmentColor {
  name: string;
  code: string;
  colors: string;
  hex: string;
  image?: string;
}

export const PIGMENT_COLORS: PigmentColor[] = [
  // A remplir — couleurs du site Torginol Pigment
];

// --- Solid Colors (Commercial / Sous-sol) ---
export interface SolidColor {
  name: string;
  code: string;
  colors: string;
  hex: string;
  image?: string;
}

export const SOLID_COLORS: SolidColor[] = [
  // Gris — les plus populaires
  { name: 'Gris Pale', code: 'UNI-01', colors: 'gris clair lumineux', hex: '#C8C8C8' },
  { name: 'Gris Perle', code: 'UNI-02', colors: 'gris doux, argente', hex: '#B0B0B0' },
  { name: 'Gris Moyen', code: 'UNI-03', colors: 'gris classique', hex: '#909090' },
  { name: 'Gris Fonce', code: 'UNI-04', colors: 'gris profond', hex: '#6A6A6A' },
  { name: 'Charcoal', code: 'UNI-05', colors: 'gris charbon fonce', hex: '#454545' },
  // Beige / Tan
  { name: 'Beige Clair', code: 'UNI-06', colors: 'beige sable doux', hex: '#D4C4A8' },
  { name: 'Beige', code: 'UNI-07', colors: 'beige classique chaud', hex: '#C2A882' },
  { name: 'Tan', code: 'UNI-08', colors: 'brun sable chaud', hex: '#B89A6A' },
  // Blanc
  { name: 'Blanc', code: 'UNI-09', colors: 'blanc pur', hex: '#F5F5F5' },
  { name: 'Blanc Casse', code: 'UNI-10', colors: 'blanc chaud ivoire', hex: '#EDE8D8' },
  // Noir
  { name: 'Noir', code: 'UNI-11', colors: 'noir profond', hex: '#1A1A1A' },
  // Bleu
  { name: 'Bleu Royal', code: 'UNI-12', colors: 'bleu vif royal', hex: '#2B4C8C' },
  { name: 'Bleu Gris', code: 'UNI-13', colors: 'bleu ardoise', hex: '#5A7080' },
  // Vert
  { name: 'Vert Foret', code: 'UNI-14', colors: 'vert fonce profond', hex: '#2D5A3D' },
  // Rouge
  { name: 'Rouge Brique', code: 'UNI-15', colors: 'rouge terre cuite', hex: '#8B3A2F' },
  { name: 'Rouge Securite', code: 'UNI-16', colors: 'rouge vif industriel', hex: '#B22222' },
];
