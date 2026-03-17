// Torginol Flake Color Catalog for Novus Epoxy
// Complete catalog from torginol.com Flake Flooring product line

export interface FlakeColor {
  name: string;
  code: string;
  colors: string; // description des couleurs principales
  category: 'neutre' | 'terre' | 'bleu' | 'vert' | 'brun' | 'rouge' | 'sombre';
  // CSS-approximate hex for swatch background
  hex: string;
}

export const FLAKE_COLORS: FlakeColor[] = [
  // Neutres — gris, blanc, noir
  { name: 'Sand Dollar', code: 'FB-951', colors: 'beige pale, blanc, gris clair', category: 'neutre', hex: '#c9c0b3' },
  { name: 'Opal', code: 'FB-901', colors: 'gris perle, blanc, beige', category: 'neutre', hex: '#b8b0a5' },
  { name: 'Siberian', code: 'FB-902', colors: 'gris clair, blanc, touches beige', category: 'neutre', hex: '#b5afa6' },
  { name: 'Glacial', code: 'FB-940', colors: 'gris bleu pale, blanc, argent', category: 'neutre', hex: '#a8adb0' },
  { name: 'Birch Bark', code: 'FB-1005', colors: 'blanc casse, gris clair, beige', category: 'neutre', hex: '#c5bfb5' },
  { name: 'Victorian', code: 'FB-818', colors: 'gris moyen, blanc, charcoal', category: 'neutre', hex: '#8e8b87' },
  { name: 'Colonial', code: 'FB-817', colors: 'gris bleu, blanc, charcoal', category: 'neutre', hex: '#7d8085' },
  { name: 'Suave', code: 'FB-920', colors: 'beige, gris, blanc creme', category: 'neutre', hex: '#a8a098' },
  { name: 'Cannoli', code: 'FB-130', colors: 'creme, beige pale, blanc', category: 'neutre', hex: '#c2b9ad' },
  { name: 'Sea Crest', code: 'FB-803', colors: 'gris vert pale, blanc, argent', category: 'neutre', hex: '#969e98' },
  { name: 'Feather Gray', code: 'FB-905', colors: 'gris doux, blanc, argent', category: 'neutre', hex: '#9a9590' },
  { name: 'Quicksilver', code: 'FB-424', colors: 'argent, gris pale, blanc', category: 'neutre', hex: '#929396' },
  { name: 'Nimbus', code: 'FB-927', colors: 'gris nuage, blanc, charcoal', category: 'neutre', hex: '#8a8d90' },
  { name: 'Blizzard', code: 'FB-6001', colors: 'blanc, gris pale, argent', category: 'neutre', hex: '#b5b8b5' },
  { name: 'Arctic', code: 'FB-704', colors: 'blanc gris, argent, gris clair', category: 'neutre', hex: '#a3a5a0' },
  { name: 'Snowfall', code: 'FB-602', colors: 'blanc, gris tres pale, argent', category: 'neutre', hex: '#bbbdb8' },
  { name: 'Sea Mist', code: 'FB-805', colors: 'gris vert, blanc, argent', category: 'neutre', hex: '#929b95' },
  { name: 'Stony Creek', code: 'FB-806', colors: 'gris pierre, brun, blanc', category: 'neutre', hex: '#8a8580' },
  { name: 'Morning Dew', code: 'FB-609', colors: 'gris clair, blanc, vert pale', category: 'neutre', hex: '#9a9d95' },
  { name: 'Magnolia', code: 'FB-942', colors: 'blanc chaud, beige, gris', category: 'neutre', hex: '#b0a89e' },
  { name: 'Stargazer', code: 'FB-908', colors: 'gris moyen, bleu, blanc', category: 'neutre', hex: '#7e8288' },
  { name: 'Wild Dove', code: 'FB-911', colors: 'gris colombe, blanc, charcoal', category: 'neutre', hex: '#8a8885' },
  { name: 'Summit', code: 'FB-721', colors: 'gris, brun, blanc', category: 'neutre', hex: '#8a8580' },
  { name: 'Avalanche', code: 'FB-722', colors: 'gris clair, blanc, charcoal', category: 'neutre', hex: '#9a9895' },
  { name: 'Pumice', code: 'FS303', colors: 'gris beige, blanc, brun pale', category: 'neutre', hex: '#a09a90' },
  { name: 'Gravel', code: 'FB-414', colors: 'gris, brun, charcoal', category: 'neutre', hex: '#807d78' },

  // Terre — brun, beige, sable, caramel
  { name: 'Prairie', code: 'FB-529', colors: 'brun sable, beige, creme', category: 'terre', hex: '#a09080' },
  { name: 'Citrine', code: 'FB-978', colors: 'brun dore, beige, caramel', category: 'terre', hex: '#9a8570' },
  { name: 'Steelcut', code: 'FB-720', colors: 'brun gris, beige, charcoal', category: 'terre', hex: '#8a8078' },
  { name: 'Cabin Fever', code: 'FB-127', colors: 'brun chaud, beige, creme', category: 'terre', hex: '#9a8570' },
  { name: 'Anvil', code: 'FB-726', colors: 'gris brun, charcoal, beige', category: 'terre', hex: '#7d7570' },
  { name: 'Chickadee', code: 'FB-967', colors: 'brun, beige, noir', category: 'terre', hex: '#8a7565' },
  { name: 'Coyote', code: 'FB-513', colors: 'brun sable, beige, caramel', category: 'terre', hex: '#9a8570' },
  { name: 'Gracious', code: 'FB-016', colors: 'beige chaud, brun, creme', category: 'terre', hex: '#b0a090' },
  { name: 'Shoreline', code: 'FB-421', colors: 'sable, brun clair, blanc', category: 'terre', hex: '#a89888' },
  { name: 'Bambi', code: 'FB-959', colors: 'brun faon, beige, creme', category: 'terre', hex: '#a08e78' },
  { name: 'Stonehenge', code: 'FB-427', colors: 'gris pierre, brun, beige', category: 'terre', hex: '#8a8278' },
  { name: 'Reed', code: 'FB-507', colors: 'brun vert, beige, olive', category: 'terre', hex: '#8a8068' },
  { name: 'Saddle Tan', code: 'SDT', colors: 'brun, beige, caramel', category: 'terre', hex: '#9a7e60' },
  { name: 'Outback', code: 'FB-517', colors: 'brun rouge, sable, terre cuite', category: 'terre', hex: '#9a7560' },
  { name: 'Sahara', code: 'SAH', colors: 'sable, beige dore, brun clair', category: 'terre', hex: '#b5a080' },
  { name: 'Buckskin', code: 'BKS', colors: 'beige chaud, brun, creme', category: 'terre', hex: '#b09a80' },
  { name: 'Cappuccino', code: 'CAP', colors: 'brun cafe, creme, beige', category: 'terre', hex: '#8a7060' },
  { name: 'Mocha', code: 'MOC', colors: 'brun chocolat, beige, noir', category: 'terre', hex: '#6a5545' },
  { name: 'Talus', code: 'FS919', colors: 'brun gris, beige, charcoal', category: 'terre', hex: '#8a7d70' },
  { name: 'Waxwing', code: 'FB-968', colors: 'brun roux, beige, sable', category: 'terre', hex: '#9a7a60' },
  { name: 'Splitie', code: 'FS313', colors: 'brun, beige, gris', category: 'terre', hex: '#8a7d70' },
  { name: 'Thyme', code: 'FB-977', colors: 'brun olive, beige, vert', category: 'terre', hex: '#8a8068' },
  { name: 'Timberwolf', code: 'FB-909', colors: 'gris brun, beige, charcoal', category: 'terre', hex: '#807870' },
  { name: 'Sable', code: 'FS005', colors: 'brun sable, beige, caramel', category: 'terre', hex: '#9a8570' },
  { name: 'Caraway', code: 'FB-510', colors: 'brun epice, beige, creme', category: 'terre', hex: '#8a7560' },
  { name: 'Capricorn', code: 'FB-818', colors: 'brun gris, beige, charcoal', category: 'terre', hex: '#807568' },
  { name: 'Madras', code: 'FB-706', colors: 'brun chaud, sable, caramel', category: 'terre', hex: '#9a7e60' },
  { name: 'Oasis', code: 'FB-712', colors: 'brun dore, sable, beige', category: 'terre', hex: '#a08868' },
  { name: 'Polar', code: 'FB-330', colors: 'gris pale, brun, blanc', category: 'terre', hex: '#a09890' },
  { name: 'Wren', code: 'FB-970', colors: 'brun, gris, beige', category: 'terre', hex: '#8a7d70' },
  { name: 'Loon', code: 'FB-966', colors: 'brun fonce, gris, beige', category: 'terre', hex: '#7a6d60' },
  { name: 'Safari', code: 'FB-504', colors: 'brun safari, sable, beige', category: 'terre', hex: '#9a8268' },
  { name: 'Sedum', code: 'FB-931', colors: 'brun vert, beige, olive', category: 'terre', hex: '#8a7d65' },
  { name: 'Creekbed', code: 'FB-716', colors: 'brun pierre, gris, sable', category: 'terre', hex: '#8a7d70' },
  { name: 'Mushroom', code: 'FB-714', colors: 'brun champignon, gris, beige', category: 'terre', hex: '#8a8078' },

  // Vert — tons verts, foret
  { name: 'Soapstone', code: 'FS320', colors: 'vert sauge, blanc, gris', category: 'vert', hex: '#8a9a80' },
  { name: 'Sprout', code: 'FB-938', colors: 'vert vif, orange, blanc', category: 'vert', hex: '#7a9a60' },
  { name: 'Slalom', code: 'FB-927', colors: 'vert foret, blanc, gris', category: 'vert', hex: '#6a8a60' },
  { name: 'Juniper', code: 'FB-927', colors: 'vert bleu, gris, blanc', category: 'vert', hex: '#607a68' },
  { name: 'Nordic Green', code: 'FB-514', colors: 'vert nordique, blanc, gris', category: 'vert', hex: '#5a7a58' },
  { name: 'Aviator', code: 'FB-430', colors: 'vert militaire, brun, gris', category: 'vert', hex: '#5a6a50' },

  // Bleu — tons bleus, ocean
  { name: 'Mercury', code: 'FB-938', colors: 'gris bleu, blanc, argent', category: 'bleu', hex: '#7a8590' },
  { name: 'Tidal Wave', code: 'FB-807', colors: 'bleu gris, blanc, ardoise', category: 'bleu', hex: '#6a7a88' },
  { name: 'Rapids', code: 'FB-506', colors: 'bleu, gris, blanc', category: 'bleu', hex: '#5a6a80' },
  { name: 'Lunar', code: 'FB-604', colors: 'gris bleu, blanc, charcoal', category: 'bleu', hex: '#6a7080' },
  { name: 'Rocky Ridge', code: 'FB-801', colors: 'bleu ardoise, gris, brun', category: 'bleu', hex: '#5a6570' },
  { name: 'Lapis', code: 'FB-963', colors: 'bleu lapis, gris, blanc', category: 'bleu', hex: '#4a5a78' },
  { name: 'Celestial', code: 'FB-926', colors: 'bleu celeste, gris, blanc', category: 'bleu', hex: '#5a6a80' },
  { name: 'Smokey Blue', code: 'FB-933', colors: 'bleu fume, gris, charcoal', category: 'bleu', hex: '#4a5568' },
  { name: 'Current', code: 'FB-528', colors: 'bleu courant, gris, noir', category: 'bleu', hex: '#4a5a70' },

  // Rouge / cuivre — tons chauds vifs
  { name: 'Magma', code: 'FB-932', colors: 'rouge, orange, noir', category: 'rouge', hex: '#8a3a30' },
  { name: 'Copperhead', code: 'CPH', colors: 'cuivre, brun, rouille metallique', category: 'rouge', hex: '#8a5a40' },
  { name: 'Autumn Blend', code: 'ATB', colors: 'orange automne, brun, rouge', category: 'rouge', hex: '#9a6040' },
  { name: 'Canyon Rock', code: 'CNR', colors: 'rouge brique, brun, sable', category: 'rouge', hex: '#8a5548' },
  { name: 'Rosy-Finch', code: 'FB-969', colors: 'rose brun, gris, beige', category: 'rouge', hex: '#8a6a68' },
  { name: 'Robin', code: 'FB-973', colors: 'brun rouge, gris, beige', category: 'rouge', hex: '#7a5a50' },
  { name: 'Fig', code: 'FB-948', colors: 'violet brun, gris, charcoal', category: 'rouge', hex: '#6a4a48' },
  { name: 'Feldspar', code: 'FS203', colors: 'rouge brique, brun, beige', category: 'rouge', hex: '#8a5540' },
  { name: 'Crossbow', code: 'FB-520', colors: 'brun rouge, gris, charcoal', category: 'rouge', hex: '#6a4a40' },

  // Sombre — noir, charcoal, fonce
  { name: 'Nightfall', code: 'FB-715', colors: 'noir, brun fonce, charcoal', category: 'sombre', hex: '#3a3530' },
  { name: 'Kismet', code: 'FB-945', colors: 'brun fonce, noir, cuivre', category: 'sombre', hex: '#4a3a30' },
  { name: 'Quail', code: 'FB-974', colors: 'brun fonce, gris, charcoal', category: 'sombre', hex: '#4a4038' },
  { name: 'Sparrow', code: 'FB-972', colors: 'gris fonce, brun, noir', category: 'sombre', hex: '#4a4540' },
  { name: 'Cast Iron', code: 'FB-925', colors: 'noir, gris fonce, charcoal', category: 'sombre', hex: '#3a3838' },
  { name: 'Rainstorm', code: 'FB-944', colors: 'gris orage, bleu fonce, noir', category: 'sombre', hex: '#3a4048' },
  { name: 'Moose', code: 'FB-924', colors: 'brun fonce, charcoal, noir', category: 'sombre', hex: '#4a4038' },
  { name: 'Chicory', code: 'FB-947', colors: 'bleu fonce, gris, noir', category: 'sombre', hex: '#3a4048' },
  { name: 'Woodpecker', code: 'FB-975', colors: 'brun fonce, charcoal, gris', category: 'sombre', hex: '#4a4038' },
  { name: 'Full Moon', code: 'FB-917', colors: 'gris fonce, blanc, noir', category: 'sombre', hex: '#4a4a4a' },
  { name: 'Black Ice', code: 'FB-934', colors: 'noir, bleu fonce, charcoal', category: 'sombre', hex: '#2a2a30' },
  { name: 'Raven', code: 'FB-915', colors: 'noir, gris fonce, charcoal', category: 'sombre', hex: '#2a2a28' },
  { name: 'Carbon', code: 'FS202', colors: 'noir, gris graphite, charcoal', category: 'sombre', hex: '#252525' },
  { name: 'Chenille', code: 'FB-981', colors: 'gris charcoal, noir, brun', category: 'sombre', hex: '#3a3838' },
  { name: 'Gargoyle', code: 'FB-918', colors: 'gris fonce, bleu, noir', category: 'sombre', hex: '#3a3d42' },
  { name: 'Obsidian', code: 'FS304', colors: 'noir, gris fonce, charcoal', category: 'sombre', hex: '#2a2a2a' },
  { name: 'Dolerite', code: 'FS311', colors: 'gris fonce, noir, bleu', category: 'sombre', hex: '#35383d' },
  { name: 'Garnet', code: 'FS305', colors: 'gris charcoal, brun, noir', category: 'sombre', hex: '#3a3535' },
  { name: 'Merino', code: 'FB-971', colors: 'gris brun fonce, charcoal', category: 'sombre', hex: '#4a4540' },
  { name: 'Burrow', code: 'FB-723', colors: 'brun fonce, gris, charcoal', category: 'sombre', hex: '#4a3d35' },
  { name: 'Koala', code: 'FB-811', colors: 'gris brun, charcoal, noir', category: 'sombre', hex: '#4a4540' },
  { name: 'Java', code: 'FB-523', colors: 'brun cafe fonce, noir', category: 'sombre', hex: '#3a3028' },
  { name: 'Fog', code: 'FB-703', colors: 'gris fonce, bleu, charcoal', category: 'sombre', hex: '#4a4d52' },
  { name: 'Frostbite', code: 'FB-930', colors: 'gris bleu fonce, noir, blanc', category: 'sombre', hex: '#3a4048' },
  { name: 'Voltage', code: 'FB-946', colors: 'bleu fonce, gris, noir', category: 'sombre', hex: '#35404a' },
  { name: 'Houndstooth', code: 'FB-510', colors: 'noir, blanc, gris contraste', category: 'sombre', hex: '#4a4a4a' },
  { name: 'Dovetail', code: 'FB-823', colors: 'gris, brun, charcoal', category: 'sombre', hex: '#5a5550' },
  { name: 'Sycamore', code: 'FB-6002', colors: 'gris brun, charcoal, beige', category: 'sombre', hex: '#5a5548' },
  { name: 'Buffalo', code: 'FB-956', colors: 'brun fonce, gris, noir', category: 'sombre', hex: '#4a4038' },

  // Autres
  { name: 'Swan', code: 'FB-612', colors: 'blanc, gris pale, vert', category: 'vert', hex: '#a0aa98' },
  { name: 'Woven', code: 'FB-919', colors: 'beige, gris, brun', category: 'terre', hex: '#9a9088' },
  { name: 'Moon Mist', code: 'FB-906', colors: 'gris pale, blanc, bleu', category: 'neutre', hex: '#9a9d98' },
  { name: 'Bramble', code: 'FB-941', colors: 'brun, vert, gris', category: 'vert', hex: '#6a7a60' },
  { name: 'Water Lily', code: 'FB-321', colors: 'vert eau, blanc, gris', category: 'vert', hex: '#7a9a88' },
  { name: 'Stinger', code: 'FB-506', colors: 'jaune vert, brun, gris', category: 'vert', hex: '#8a9a60' },
  { name: 'Silver Bells', code: 'FB-903', colors: 'argent, blanc, gris', category: 'neutre', hex: '#a5a8a5' },
  { name: 'Trailmix', code: 'FB-613', colors: 'brun, beige, vert', category: 'terre', hex: '#8a8068' },
  { name: 'Arkose', code: 'FS318', colors: 'gris rose, beige, brun', category: 'terre', hex: '#9a8a80' },
  { name: 'Submarine', code: 'FB-608', colors: 'vert fonce, gris, noir', category: 'vert', hex: '#4a5a48' },
  { name: 'Schist', code: 'FB-415', colors: 'gris ardoise, brun, charcoal', category: 'sombre', hex: '#5a5550' },
  { name: 'Cardamom', code: 'FB-508', colors: 'brun epice, vert, beige', category: 'terre', hex: '#7a7058' },
  { name: 'Galaxy', code: 'FB-807', colors: 'bleu fonce, gris, blanc', category: 'bleu', hex: '#4a5568' },
  { name: 'Comet', code: 'FB-711', colors: 'gris bleu, brun, charcoal', category: 'bleu', hex: '#5a6068' },
  { name: 'Domino', code: 'FB-411', colors: 'noir, blanc, gris contraste', category: 'sombre', hex: '#4a4a4a' },
  { name: 'Dingo', code: 'FB-980', colors: 'brun, gris, charcoal', category: 'terre', hex: '#7a6d60' },
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
}

export const SOLID_COLORS: SolidColor[] = [
  // A remplir — couleurs unies pour commercial/sous-sol
];
